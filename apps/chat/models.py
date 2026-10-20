from typing import ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .managers import ActiveMessageManager


class ChatQuerySet(models.QuerySet):
    def active(self):
        """Returns not deleted chats only."""
        return self.filter(deleted_at__isnull=True)

    def for_user(self, user):
        """Returns only chats where user is a member."""
        return self.active().filter(memberships__user=user)

    def for_user_with_topics(self, user):
        """Returns only chats where user is a member. Includes topics where user is a member."""
        return self.active().filter(Q(memberships__user=user) | Q(parent__memberships__user=user)).distinct()

    def public(self):
        """Returns only public chats."""
        return self.active().exclude(type__in=[Chat.Type.DIRECT, Chat.Type.TOPIC])


class Chat(models.Model):
    class Type(models.TextChoices):
        DIRECT = "DIRECT", "Private dialog"
        GROUP = "GROUP", "Group chat"
        CHANNEL = "CHANNEL", "Channel"
        TOPIC = "TOPIC", "Forum thread"

    type = models.CharField(max_length=10, choices=Type.choices, default=Type.DIRECT)
    title = models.CharField(max_length=100, blank=True)
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="topics")
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    objects = ChatQuerySet.as_manager()

    def __str__(self):
        if self.type == self.Type.TOPIC and self.parent:
            return f"{self.parent.title}: {self.title}"
        return self.title or f"Chat #{self.pk}"

    def clean(self):
        if self.type == self.Type.TOPIC:
            if not self.parent:
                raise ValidationError({"parent": "Forum threads must have a parent."})
            if self.parent.type not in (self.Type.GROUP, self.Type.CHANNEL):
                raise ValidationError({"parent": "Parent must be a group or channel."})

        if self.type in (self.Type.GROUP, self.Type.CHANNEL) and not self.title:
            raise ValidationError({"title": "Groups and channels must have a title."})


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER", "Owner"
        ADMIN = "ADMIN", "Administrator"
        MEMBER = "MEMBER", "Member"

    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("chat", "user")

    def __str__(self):
        return f"{self.user} in {self.chat} ({self.get_role_display()})"


class Message(models.Model):
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = models.Manager()
    active = ActiveMessageManager()

    class Meta:
        ordering: ClassVar[list[str]] = ["created_at"]

    def __str__(self):
        return f"{self.sender}: {self.text[:20]}"
