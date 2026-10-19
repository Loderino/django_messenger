from typing import ClassVar

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response

from .models import Chat, Membership, Message
from .serializers import (
    ChatSerializer,
    DirectChatCreateSerializer,
    MessageCreateSerializer,
    MessageSerializer,
    MessageUpdateSerializer,
)


class MessageCursorPagination(CursorPagination):
    page_size = 30
    ordering = "-created_at"


class ChatViewSet(viewsets.ModelViewSet):
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.action == "join":
            return Chat.objects.public()

        if self.action == "leave":
            return Chat.objects.for_user(self.request.user)

        if self.action == "search":
            return Chat.objects.public()

        return Chat.objects.for_user(self.request.user)

    def get_serializer_class(self):
        if self.action == "direct":
            return DirectChatCreateSerializer
        return ChatSerializer

    def perform_create(self, serializer):
        chat_type = serializer.validated_data.get("type")

        if chat_type == Chat.Type.DIRECT:
            raise ValidationError({"type": "Cannot create DIRECT chat here. Use POST /api/chats/direct/ instead."})

        if chat_type == Chat.Type.TOPIC:
            parent = serializer.validated_data.get("parent")
            is_admin = parent.memberships.filter(
                user=self.request.user, role__in=[Membership.Role.OWNER, Membership.Role.ADMIN]
            ).exists()

            if not is_admin:
                raise PermissionDenied("Only admins or owners can create topics.")

            serializer.save()
            return

        chat = serializer.save()
        Membership.objects.create(chat=chat, user=self.request.user, role=Membership.Role.OWNER)

    def perform_destroy(self, instance):
        if instance.type == Chat.Type.DIRECT:
            raise PermissionDenied("You cannot delete a direct chat.")

        if instance.type == Chat.Type.TOPIC:
            parent = instance.parent
            is_admin_or_owner = parent.memberships.filter(
                user=self.request.user, role__in=[Membership.Role.OWNER, Membership.Role.ADMIN]
            ).exists()

            if not is_admin_or_owner:
                raise PermissionDenied("Only admins or owners of the parent chat can delete topics.")
        else:
            is_owner = instance.memberships.filter(user=self.request.user, role=Membership.Role.OWNER).exists()

            if not is_owner:
                raise PermissionDenied("Only the owner can delete this chat.")

        instance.deleted_at = timezone.now()
        instance.save()

    def perform_update(self, serializer):
        chat = serializer.instance
        user = self.request.user

        if chat.type == Chat.Type.DIRECT:
            # TODO: for future add ability to update direct chats when chat model will be updated
            raise PermissionDenied("Direct chats cannot be updated yet.")

        elif chat.type == Chat.Type.TOPIC:
            parent = chat.parent
            is_admin_or_owner = parent.memberships.filter(
                user=user, role__in=[Membership.Role.OWNER, Membership.Role.ADMIN]
            ).exists()

            if not is_admin_or_owner:
                raise PermissionDenied("Only admins or owners of the parent chat can edit topics.")

        else:
            is_admin_or_owner = chat.memberships.filter(
                user=user, role__in=[Membership.Role.OWNER, Membership.Role.ADMIN]
            ).exists()

            if not is_admin_or_owner:
                raise PermissionDenied("Only admins or owners can edit this chat.")
        serializer.save()

    @action(detail=False, methods=["post"])
    def direct(self, request):
        """Create direct chat with another user."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        other_user = serializer.validated_data["user"]
        if other_user == request.user:
            raise PermissionDenied("You cannot create a direct chat with yourself.")

        existing_chat = (
            Chat.objects.filter(type=Chat.Type.DIRECT, memberships__user=request.user)
            .filter(memberships__user=other_user)
            .first()
        )

        if existing_chat:
            return Response(ChatSerializer(existing_chat).data, status=status.HTTP_200_OK)

        with transaction.atomic():
            chat = Chat.objects.create(type=Chat.Type.DIRECT)
            Membership.objects.create(chat=chat, user=request.user, role=Membership.Role.ADMIN)
            Membership.objects.create(chat=chat, user=other_user, role=Membership.Role.ADMIN)

        return Response(ChatSerializer(chat).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], pagination_class=MessageCursorPagination)
    def messages(self, request, pk=None):
        chat = self.get_object()
        messages = Message.active.filter(chat=chat)
        page = self.paginate_queryset(messages)
        if page is not None:
            serializer = MessageSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = MessageSerializer(messages, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], serializer_class=None)
    def join(self, request, pk=None):
        chat = self.get_object()

        if chat.type == Chat.Type.DIRECT:
            raise PermissionDenied("You cannot join a direct chat.")

        if Membership.objects.filter(chat=chat, user=request.user).exists():
            return Response({"detail": "You are already a member."}, status=status.HTTP_400_BAD_REQUEST)

        Membership.objects.create(chat=chat, user=request.user, role=Membership.Role.MEMBER)

        return Response({"detail": "Successfully joined the chat."}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], serializer_class=None)
    def leave(self, request, pk=None):
        chat = self.get_object()

        if chat.type == Chat.Type.DIRECT:
            raise PermissionDenied("You cannot exit from a direct chat.")

        if chat.type == Chat.Type.TOPIC:
            raise PermissionDenied("You cannot leave a topic directly. You must leave the parent group.")

        try:
            membership = Membership.objects.get(chat=chat, user=request.user)
        except Membership.DoesNotExist:
            return Response({"detail": "You are not a member of this chat."}, status=status.HTTP_400_BAD_REQUEST)

        if membership.role == Membership.Role.OWNER:
            raise PermissionDenied("You cannot exit from a chat you own.")

        membership.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"])
    def search(self, request):
        query = request.query_params.get("q", "").strip()

        if not query:
            return Response({"detail": "Query parameter 'q' is required."}, status=status.HTTP_400_BAD_REQUEST)

        chats = self.get_queryset().filter(title__icontains=query)
        page = self.paginate_queryset(chats)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(chats, many=True)
        return Response(serializer.data)


class MessageViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Message.active.filter(
            Q(chat__memberships__user=self.request.user) | Q(chat__parent__memberships__user=self.request.user)
        ).distinct()

    def get_serializer_class(self):
        if self.action in ["update", "partial_update"]:
            return MessageUpdateSerializer
        return MessageCreateSerializer

    def perform_create(self, serializer):
        chat = serializer.validated_data["chat"]

        if not Membership.objects.filter(chat=chat, user=self.request.user).exists():
            raise PermissionDenied("You are not a member of this chat.")

        message = serializer.save(sender=self.request.user)
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"chat_{message.chat_id}",
            {
                "type": "chat_message",
                "message": {
                    "id": message.id,
                    "text": message.text,
                    "sender_name": message.sender.display_name or message.sender.username,
                    "created_at": message.created_at.isoformat(),
                },
            },
        )

    def perform_update(self, serializer):
        instance = serializer.instance

        if instance.deleted_at:
            raise PermissionDenied("You can't update deleted messages.")

        if instance.sender != self.request.user:
            raise PermissionDenied("You can only update your own messages.")

        if timezone.now() - instance.created_at >= timezone.timedelta(minutes=30):
            raise PermissionDenied("You can't update old messages.")
        serializer.save(updated_at=timezone.now())

    def perform_destroy(self, instance):
        if instance.sender != self.request.user:
            raise PermissionDenied("You can only delete your own messages.")

        instance.deleted_at = timezone.now()
        instance.save()
