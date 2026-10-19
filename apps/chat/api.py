from typing import ClassVar

from django.utils import timezone
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response

from .models import Chat, Membership, Message
from .serializers import ChatSerializer, MessageCreateSerializer, MessageSerializer, MessageUpdateSerializer


class MessageCursorPagination(CursorPagination):
    page_size = 30
    ordering = "-created_at"


class ChatViewSet(viewsets.ModelViewSet):
    serializer_class = ChatSerializer
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Chat.objects.filter(memberships__user=self.request.user)

    def perform_create(self, serializer):
        chat = serializer.save()
        Membership.objects.create(chat=chat, user=self.request.user, role=Membership.Role.OWNER)

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


class MessageViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Message.active.filter(chat__memberships__user=self.request.user)

    def get_serializer_class(self):
        if self.action in ["update", "partial_update"]:
            return MessageUpdateSerializer
        return MessageCreateSerializer

    def perform_create(self, serializer):
        chat = serializer.validated_data["chat"]

        if not Membership.objects.filter(chat=chat, user=self.request.user).exists():
            raise PermissionDenied("You are not a member of this chat.")

        serializer.save(sender=self.request.user)

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
