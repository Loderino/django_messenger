from typing import ClassVar

from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields: ClassVar[list[str]] = [
            "id",
            "username",
            "display_name",
            "bio",
            "avatar",
            "avatar_url",
            "last_seen",
            "block_status",
            "blocked_until",
        ]
        read_only_fields: ClassVar[list[str]] = ["id", "username", "avatar_url", "last_seen"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        is_self = request and request.user.is_authenticated and request.user.id == instance.id
        if not is_self:
            for field in ("username", "display_name", "avatar", "block_status", "blocked_until"):
                data.pop(field, None)
        return data

    def validate_display_name(self, value):
        value = value.strip()
        if " " in value:
            raise serializers.ValidationError("Display name cannot contain spaces.")
        if value and value.isdigit():
            raise serializers.ValidationError("Display name cannot be only digits.")
        if len(value) > 15 or len(value) < 4:
            raise serializers.ValidationError("Display name mast be between 4 and 15 characters.")
        return value
