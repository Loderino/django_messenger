from typing import ClassVar

from rest_framework import serializers

from .models import Chat, Membership, Message


class ChatSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chat
        fields: ClassVar[list[str]] = ["id", "type", "title", "parent", "created_at"]
        read_only_fields: ClassVar[list[str]] = ["id", "created_at"]


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields: ClassVar[list[str]] = ["id", "chat", "sender", "sender_name", "text", "created_at", "updated_at"]
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at"]

    def get_sender_name(self, obj):
        return obj.sender.display_name or obj.sender.username


class MessageCreateSerializer(MessageSerializer):
    class Meta(MessageSerializer.Meta):
        fields = MessageSerializer.Meta.fields
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at"]


class MessageUpdateSerializer(MessageSerializer):
    class Meta(MessageSerializer.Meta):
        read_only_fields: ClassVar[list[str]] = ["id", "sender", "created_at", "updated_at", "chat"]


class MembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields: ClassVar[list[str]] = ["id", "chat", "user", "user_name", "role", "joined_at"]
        read_only_fields: ClassVar[list[str]] = ["id", "joined_at"]

    def get_user_name(self, obj):
        return obj.user.display_name or obj.user.username
