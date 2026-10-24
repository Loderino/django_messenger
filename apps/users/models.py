from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models


class BlockStatus(models.TextChoices):
    NONE = "NONE", "Not banned"
    TEMPORARY = "TMP", "temporarily banned"
    PERMANENT = "PRM", "permanently banned"


class User(AbstractUser):
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=50, unique=True, default=None)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    bio = models.TextField(max_length=500, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    block_status = models.CharField(
        max_length=4,
        choices=BlockStatus.choices,
        default=BlockStatus.NONE,
    )
    blocked_until = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.display_name or self.username

    @property
    def avatar_url(self):
        if self.avatar:
            return self.avatar.url
        return "/static/images/avatars/default.jpg"

    def clean(self):
        super().clean()
        if self.username and self.username.isdigit():
            raise ValidationError({"username": "Username cannot be only digits."})
        if self.display_name:
            if self.display_name.isdigit():
                raise ValidationError({"display_name": "Display name cannot be only digits."})
            if " " in self.display_name:
                raise ValidationError({"display_name": "Display name cannot contain spaces."})

    def save(self, *args, **kwargs):
        if not self.display_name:
            self.display_name = self.username
        self.full_clean()
        super().save(*args, **kwargs)
