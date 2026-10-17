from django.contrib.auth.models import AbstractUser
from django.db import models


class BlockStatus(models.TextChoices):
    NONE = "NONE", "Not banned"
    TEMPORARY = "TMP", "temporarily banned"
    PERMANENT = "PRM", "permanently banned"


class User(AbstractUser):
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=50, blank=True)
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
