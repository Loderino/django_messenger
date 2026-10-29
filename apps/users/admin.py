from typing import ClassVar

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = (
        *UserAdmin.fieldsets,
        ("additional", {"fields": ("display_name", "avatar", "bio", "block_status", "blocked_until", "last_seen")}),
    )
    list_display: ClassVar[list[str]] = ["username", "email", "display_name", "block_status", "is_active"]
    search_fields: ClassVar[list[str]] = ["username", "email", "display_name"]

    add_fieldsets = (
        *UserAdmin.add_fieldsets,
        (
            "Additional",
            {
                "classes": ("wide",),
                "fields": ("email", "display_name", "avatar", "bio", "block_status", "blocked_until", "last_seen"),
            },
        ),
    )

    prepopulated_fields: ClassVar[dict[str, tuple[str, ...]]] = {"display_name": ("username",)}
