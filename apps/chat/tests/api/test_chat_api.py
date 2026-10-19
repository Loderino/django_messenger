import pytest
from django.urls import reverse

from apps.chat.models import Chat, Membership, Message


@pytest.mark.django_db
class TestChatAPI:
    def test_create_chat_success(self, auth_client, user):
        """If user creates a GROUP chat, he becomes a member with role OWNER."""
        url = reverse("chat-list")
        data = {"type": Chat.Type.GROUP, "title": "My New Group"}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.first()
        assert chat.title == "My New Group"

        membership = Membership.objects.get(chat=chat, user=user)
        assert membership.role == Membership.Role.OWNER

    def test_list_chats_only_returns_user_chats(self, auth_client, chat_with_user, other_user):
        """User can see only chats where he is a member."""
        foreign_chat = Chat.objects.create(type=Chat.Type.GROUP, title="Foreign Chat")
        Membership.objects.create(chat=foreign_chat, user=other_user)

        url = reverse("chat-list")
        response = auth_client.get(url)

        assert response.status_code == 200

        if isinstance(response.data, dict) and "results" in response.data:
            response_data = response.data["results"]
        else:
            response_data = response.data

        assert len(response_data) == 1
        assert response_data[0]["id"] == chat_with_user.id

    def test_get_chat_messages_success(self, auth_client, user, other_user, chat_with_user):
        """Chat member can get messages from chat."""
        Membership.objects.create(chat=chat_with_user, user=other_user)

        Message.objects.create(chat=chat_with_user, sender=user, text="Msg 1")
        Message.objects.create(chat=chat_with_user, sender=other_user, text="Msg 2")

        deleted_msg = Message.objects.create(chat=chat_with_user, sender=user, text="Deleted")
        deleted_msg.deleted_at = "2026-10-19T00:00:00Z"
        deleted_msg.save()

        url = reverse("chat-messages", args=[chat_with_user.id])
        response = auth_client.get(url)

        assert response.status_code == 200

        messages = response.data["results"]
        assert len(messages) == 2
        assert messages[0]["text"] == "Msg 2"
        assert messages[1]["text"] == "Msg 1"

    def test_get_chat_messages_forbidden(self, auth_client, other_user):
        """Deny get messages from chat, where user is not a member."""
        foreign_chat = Chat.objects.create(type=Chat.Type.GROUP, title="Foreign Chat")
        Membership.objects.create(chat=foreign_chat, user=other_user)

        url = reverse("chat-messages", args=[foreign_chat.id])
        response = auth_client.get(url)
        assert response.status_code == 404
