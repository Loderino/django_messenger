from typing import ClassVar

from django.contrib import admin

from .models import Chat, Membership, Message


@admin.register(Chat)
class ChatAdmin(admin.ModelAdmin):
    list_display: ClassVar[list[str]] = ["id", "title", "type", "created_at"]
    list_filter: ClassVar[list[str]] = ["type"]
    search_fields: ClassVar[list[str]] = ["title"]


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display: ClassVar[list[str]] = ["id", "chat", "sender", "text", "created_at"]
    search_fields: ClassVar[list[str]] = ["text", "sender__username", "chat__title"]
    list_select_related: ClassVar[list[str]] = ["chat", "sender"]
    date_hierarchy: ClassVar[str] = "created_at"


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display: ClassVar[list[str]] = ["id", "chat", "user", "role", "joined_at"]
    list_filter: ClassVar[list[str]] = ["role"]
    search_fields: ClassVar[list[str]] = ["user__username", "chat__title"]
    list_select_related: ClassVar[list[str]] = ["chat", "user"]
