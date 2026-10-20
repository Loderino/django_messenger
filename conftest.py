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
def auth_client(user):
    """Client authorized as `user`."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def other_auth_client(other_user):
    """Client authorized as `other_user`."""
    client = APIClient()
    client.force_authenticate(user=other_user)
    return client


@pytest.fixture
def group_chat_with_user(db, user):
    """test_group"""
    chat = Chat.objects.create(type=Chat.Type.GROUP, title="Test Group Chat")
    Membership.objects.create(chat=chat, user=user, role=Membership.Role.OWNER)
    return chat


@pytest.fixture
def channel_chat_with_user(db, user):
    """test_channel"""
    chat = Chat.objects.create(type=Chat.Type.CHANNEL, title="Test Channel Chat")
    Membership.objects.create(chat=chat, user=user, role=Membership.Role.OWNER)
    return chat


@pytest.fixture
def direct_chat_with_user_and_other(db, user, other_user):
    """test_direct"""
    chat = Chat.objects.create(type=Chat.Type.DIRECT)
    Membership.objects.create(chat=chat, user=user, role=Membership.Role.ADMIN)
    Membership.objects.create(chat=chat, user=other_user, role=Membership.Role.ADMIN)
    return chat
