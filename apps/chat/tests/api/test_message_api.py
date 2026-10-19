from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.chat.models import Chat, Membership, Message


@pytest.mark.django_db
class TestMessageAPI:
    def test_create_message_success(self, auth_client, user, chat_with_user):
        """User can send message to chat, where he is a member."""
        url = reverse("message-list")
        data = {"chat": chat_with_user.id, "text": "Hello!"}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        assert Message.objects.count() == 1
        message = Message.objects.first()
        assert message.text == "Hello!"
        assert message.sender == user
        assert message.updated_at is None
        assert message.deleted_at is None

    def test_create_message_forbidden(self, auth_client, other_user):
        """User can`t send message to chat, where he is not a member."""
        other_chat = Chat.objects.create(type=Chat.Type.GROUP, title="Other")
        Membership.objects.create(chat=other_chat, user=other_user)

        url = reverse("message-list")
        data = {"chat": other_chat.id, "text": "Hack!"}

        response = auth_client.post(url, data)

        assert response.status_code == 403
        assert Message.objects.count() == 0

    def test_update_own_message_success(self, auth_client, user, chat_with_user):
        """User can update own message."""
        message = Message.objects.create(chat=chat_with_user, sender=user, text="Old")
        url = reverse("message-detail", args=[message.id])

        response = auth_client.patch(url, {"text": "New"})

        assert response.status_code == 200
        message.refresh_from_db()
        assert message.text == "New"
        assert message.updated_at is not None

    def test_update_message_after_30_min_fails(self, auth_client, user, chat_with_user):
        """User can`t update own message after 30 min."""
        message = Message.objects.create(chat=chat_with_user, sender=user, text="Old")
        message.created_at = timezone.now() - timedelta(minutes=31)
        message.save()

        url = reverse("message-detail", args=[message.id])
        response = auth_client.patch(url, {"text": "New"})

        assert response.status_code == 403
        assert "update old messages" in response.data["detail"]
        message.refresh_from_db()
        assert message.text == "Old"

    def test_update_other_message_fails(self, auth_client, chat_with_user, other_user):
        """User can`t update other user`s message."""
        message = Message.objects.create(chat=chat_with_user, sender=other_user, text="Old")
        url = reverse("message-detail", args=[message.id])

        response = auth_client.patch(url, {"text": "Hack"})

        assert response.status_code == 403
        message.refresh_from_db()
        assert message.text == "Old"

    def test_move_message_to_another_chat_fails(self, auth_client, user, chat_with_user):
        """Deny move message to another chat."""
        message = Message.objects.create(chat=chat_with_user, sender=user, text="Old")
        new_chat = Chat.objects.create(type=Chat.Type.GROUP, title="New Chat")
        Membership.objects.create(chat=new_chat, user=user)

        url = reverse("message-detail", args=[message.id])
        response = auth_client.patch(url, {"chat": new_chat.id, "text": "Moved"})

        assert response.status_code == 200
        message.refresh_from_db()
        assert message.chat == chat_with_user

    def test_soft_delete_message(self, auth_client, user, chat_with_user):
        """Message deleting is soft."""
        message = Message.objects.create(chat=chat_with_user, sender=user, text="To be deleted")
        url = reverse("message-detail", args=[message.id])

        response = auth_client.delete(url)

        assert response.status_code == 204
        message.refresh_from_db()
        assert message.deleted_at is not None
        assert Message.active.count() == 0
