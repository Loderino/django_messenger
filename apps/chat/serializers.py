from typing import ClassVar

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Chat, Membership, Message

User = get_user_model()


class ChatSerializer(serializers.ModelSerializer):
    display_title = serializers.SerializerMethodField()
    members_count = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()
    user_role = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Chat
        fields: ClassVar[list[str]] = [
            "id",
            "type",
            "title",
            "description",
            "avatar",
            "avatar_url",
            "display_title",
            "members_count",
            "is_member",
            "user_role",
            "parent",
            "created_at",
        ]
        read_only_fields: ClassVar[list[str]] = ["id", "created_at"]

    def get_display_title(self, obj):
        request = self.context.get("request")
        if request and request.user:
            return obj.get_display_title(request.user)
        return obj.title or f"Chat #{obj.pk}"

    def get_members_count(self, obj):
        if hasattr(obj, "_members_count"):
            return obj._members_count
        return obj.memberships.count()

    def get_is_member(self, obj):
        request = self.context.get("request")
        if request and request.user:
            return obj.memberships.filter(user=request.user).exists()
        return False

    def get_avatar_url(self, obj):
        request = self.context.get("request")
        if obj.avatar:
            return obj.avatar.url
        if obj.type == Chat.Type.DIRECT and request and request.user:
            membership = obj.memberships.exclude(user=request.user).first()
            if membership:
                return membership.user.avatar_url
        return None

    def get_user_role(self, obj):
        request = self.context.get("request")
        if request and request.user:
            membership = obj.memberships.filter(user=request.user).first()
            if membership:
                return membership.role
        return None

    def validate(self, attrs):
        chat_type = attrs.get("type", getattr(self.instance, "type", None))
        parent = attrs.get("parent", getattr(self.instance, "parent", None))

        if chat_type == Chat.Type.TOPIC:
            if not parent:
                raise serializers.ValidationError({"parent": "Forum threads (topics) must have a parent."})
            if parent.type not in (Chat.Type.GROUP, Chat.Type.CHANNEL):
                raise serializers.ValidationError({"parent": "Parent must be a group or channel."})

        if chat_type in (Chat.Type.GROUP, Chat.Type.CHANNEL):
            title = attrs.get("title", getattr(self.instance, "title", None))
            if not title:
                raise serializers.ValidationError({"title": "Groups and channels must have a title."})

        return attrs


class DirectChatCreateSerializer(serializers.Serializer):
    user_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), source="user")


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    sender_avatar = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields: ClassVar[list[str]] = [
            "id",
            "chat",
            "sender",
            "sender_name",
            "sender_avatar",
            "text",
            "created_at",
            "updated_at",
        ]
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at"]

    def get_sender_name(self, obj):
        return obj.sender.display_name

    def get_sender_avatar(self, obj):
        return obj.sender.avatar_url


class MessageCreateSerializer(MessageSerializer):
    class Meta(MessageSerializer.Meta):
        fields = MessageSerializer.Meta.fields
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at"]


class MessageUpdateSerializer(MessageSerializer):
    class Meta(MessageSerializer.Meta):
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at", "chat"]


class MembershipSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields: ClassVar[list[str]] = ["id", "chat", "user", "display_name", "avatar_url", "role", "joined_at"]
        read_only_fields: ClassVar[list[str]] = ["id", "joined_at"]

    def get_avatar_url(self, obj):
        return obj.user.avatar_url

    def get_display_name(self, obj):
        return obj.user.display_name
