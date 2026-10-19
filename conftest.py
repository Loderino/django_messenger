import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.chat.models import Chat, Membership

User = get_user_model()


@pytest.fixture
def api_client():
    """Client for API requests"""
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(username="user1", password="password123", email="user1@example.com")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="user2", password="password123", email="user2@example.com")


@pytest.fixture
def auth_client(api_client, user):
    """Client authorized as `user`."""
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def chat_with_user(db, user):
    """Chat for users."""
    chat = Chat.objects.create(type=Chat.Type.GROUP, title="Test Chat")
    Membership.objects.create(chat=chat, user=user, role=Membership.Role.OWNER)
    return chat
