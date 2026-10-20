import pytest
from django.urls import reverse

from apps.chat.models import Chat, Membership, Message


@pytest.mark.django_db
class TestChatAPI:
    def test_create_group_chat_success(self, auth_client, user):
        """If user creates a GROUP chat, he becomes a member with role OWNER."""
        url = reverse("chat-list")
        data = {"type": Chat.Type.GROUP, "title": "My New Group"}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.first()
        assert chat.title == "My New Group"

        membership = Membership.objects.get(chat=chat, user=user)
        assert membership.role == Membership.Role.OWNER

    def test_create_channel_chat_success(self, auth_client, user):
        """If user creates a CHANNEL chat, he becomes a member with role OWNER."""
        url = reverse("chat-list")
        data = {"type": Chat.Type.CHANNEL, "title": "My New Channel"}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.first()
        assert chat.title == "My New Channel"

        membership = Membership.objects.get(chat=chat, user=user)
        assert membership.role == Membership.Role.OWNER

    def test_create_topic_chat_without_parent(self, auth_client):
        """If user creates a TOPIC chat without parent chat, it fails."""
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Topic"}

        response = auth_client.post(url, data)

        assert response.status_code == 400
        assert Chat.objects.first() is None

    def test_create_topic_chat_with_wrong_parent(
        self, auth_client, direct_chat_with_user_and_other, group_chat_with_user
    ):
        """If user creates a TOPIC chat with wrong parent type, it fails."""
        # ===== CASE 1: parent is direct =====
        chat_url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Topic", "parent": direct_chat_with_user_and_other.id}
        response = auth_client.post(chat_url, data)

        assert response.status_code == 400
        assert Chat.objects.filter(type=Chat.Type.TOPIC).first() is None

        # ===== CASE 2: parent is topic =====
        data = {"type": Chat.Type.TOPIC, "title": "Parent topic", "parent": group_chat_with_user.id}
        response = auth_client.post(chat_url, data)

        parent_topic = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        data = {"type": Chat.Type.TOPIC, "title": "New topic", "parent": parent_topic.id}
        response = auth_client.post(chat_url, data)

        assert response.status_code == 400
        assert Chat.objects.filter(type=Chat.Type.TOPIC, parent=parent_topic).first() is None

    def test_create_topic_chat_by_member(self, other_auth_client, group_chat_with_user):
        """If user with role MEMBER in parent chat creates a TOPIC chat, it fails."""

        url = reverse("chat-join", args=[group_chat_with_user.id])
        response = other_auth_client.post(url)
        assert response.status_code == 201

        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = other_auth_client.post(url, data)
        assert response.status_code == 403
        assert not Chat.objects.filter(type=Chat.Type.TOPIC).exists()

    def test_create_topic_chat_success(
        self, auth_client, other_auth_client, user, other_user, group_chat_with_user, channel_chat_with_user
    ):
        """If user creates a TOPIC with a valid parent, it succeeds and no separate Membership is created (inherited from parent)."""
        # ===== CASE 1: parent is group =====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.filter(type=Chat.Type.TOPIC, parent=group_chat_with_user).first()
        assert chat.title == "My New Group Topic"
        assert not Membership.objects.filter(chat=chat, user=user).exists()

        # ===== CASE 2: parent is channel =====
        data = {"type": Chat.Type.TOPIC, "title": "My New Channel Topic", "parent": channel_chat_with_user.id}

        response = auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.filter(type=Chat.Type.TOPIC, parent=channel_chat_with_user).first()
        assert chat.title == "My New Channel Topic"
        assert not Membership.objects.filter(chat=chat, user=user).exists()

        # ===== CASE 3: creating by admin =====
        Membership.objects.create(chat=channel_chat_with_user, user=other_user, role=Membership.Role.ADMIN)
        data = {"type": Chat.Type.TOPIC, "title": "My New Topic", "parent": channel_chat_with_user.id}
        response = other_auth_client.post(url, data)

        assert response.status_code == 201
        chat = Chat.objects.filter(type=Chat.Type.TOPIC, parent=channel_chat_with_user).first()
        assert chat.title == "My New Channel Topic"
        assert not Membership.objects.filter(chat=chat, user=user).exists()

    def test_create_direct_chat_wrong_endpoint(self, auth_client):
        """If user creates a DIRECT chat with endpoint `POST api/chat/`, it fails."""
        url = reverse("chat-list")
        data = {"type": Chat.Type.DIRECT}

        response = auth_client.post(url, data)

        assert response.status_code == 400
        assert not Chat.objects.filter(type=Chat.Type.DIRECT).exists()

    def test_create_existing_direct_chat(self, auth_client, other_user, direct_chat_with_user_and_other):
        """If user tries to create a DIRECT chat that already exists, the existing one is returned."""
        url = reverse("chat-direct")
        data = {"user_id": other_user.id}

        response = auth_client.post(url, data)

        assert response.status_code == 200
        assert Chat.objects.filter(type=Chat.Type.DIRECT).count() == 1
        assert Chat.objects.filter(type=Chat.Type.DIRECT).first() == direct_chat_with_user_and_other

    def test_create_direct_chat_success(self, auth_client, user, other_user):
        """If user creates a DIRECT chat with endpoint `POST api/chat/direct/`, it succeeds."""
        url = reverse("chat-direct")
        data = {"user_id": other_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201
        chat = Chat.objects.filter(type=Chat.Type.DIRECT).first()
        user_membership = Membership.objects.filter(chat=chat, user=user).first()
        other_user_membership = Membership.objects.filter(chat=chat, user=other_user).first()
        assert user_membership.role == Membership.Role.ADMIN
        assert other_user_membership.role == Membership.Role.ADMIN

    def test_list_chats_only_returns_user_chats(self, auth_client, group_chat_with_user, other_user):
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
        assert response_data[0]["id"] == group_chat_with_user.id

    def test_search_chats(self, auth_client, group_chat_with_user, channel_chat_with_user, other_user):
        """User can see public chats only with title matching search query."""
        foreign_group = Chat.objects.create(type=Chat.Type.GROUP, title="Foreign group")
        Membership.objects.create(chat=foreign_group, user=other_user)

        foreign_channel = Chat.objects.create(type=Chat.Type.CHANNEL, title="Foreign channel")
        Membership.objects.create(chat=foreign_channel, user=other_user)

        url = reverse("chat-search")

        # ===== CASE 1: Search chats where user is member =====
        response = auth_client.get(url, {"q": "Test"})
        assert response.status_code == 200

        if isinstance(response.data, dict) and "results" in response.data:
            response_data = response.data["results"]
        else:
            response_data = response.data

        assert len(response_data) == 2
        ids = [chat["id"] for chat in response_data]
        assert group_chat_with_user.id in ids
        assert channel_chat_with_user.id in ids

        # ===== CASE 2: Search chats where user is not member =====
        response = auth_client.get(url, {"q": "Foreign"})
        assert response.status_code == 200

        if isinstance(response.data, dict) and "results" in response.data:
            response_data = response.data["results"]
        else:
            response_data = response.data

        assert len(response_data) == 2
        ids = [chat["id"] for chat in response_data]
        assert foreign_group.id in ids
        assert foreign_channel.id in ids

        # ===== CASE 3: Search with no results =====
        response = auth_client.get(url, {"q": "NonexistentChatName"})
        assert response.status_code == 200

        if isinstance(response.data, dict) and "results" in response.data:
            response_data = response.data["results"]
        else:
            response_data = response.data

        assert len(response_data) == 0

    def test_join_chat_success(self, other_auth_client, other_user, group_chat_with_user, channel_chat_with_user):
        """If user joins a GROUP/CHANNEL chat, he becomes a member with role MEMBER."""
        # ===== CASE 1: Join to a public group =====
        url = reverse("chat-join", args=[group_chat_with_user.id])
        response = other_auth_client.post(url)

        assert response.status_code == 201
        membership = Membership.objects.get(chat=group_chat_with_user, user=other_user)
        assert membership.role == Membership.Role.MEMBER

        # ===== CASE 2: Join to a public channel =====
        url = reverse("chat-join", args=[channel_chat_with_user.id])
        response = other_auth_client.post(url)

        assert response.status_code == 201
        membership = Membership.objects.get(chat=channel_chat_with_user, user=other_user)
        assert membership.role == Membership.Role.MEMBER

    def test_join_chat_forbidden(
        self, other_user, auth_client, other_auth_client, direct_chat_with_user_and_other, group_chat_with_user
    ):
        """User cannot join DIRECT chats or TOPIC chats (only GROUP/CHANNEL are allowed)."""
        # ===== CASE 1: Join to a direct chat where user is already a member =====
        url = reverse("chat-join", args=[direct_chat_with_user_and_other.id])
        response = auth_client.post(url)
        assert response.status_code == 403

        # ===== CASE 2: Join to a direct chat where user is not a member =====
        new_direct_chat = Chat.objects.create(type=Chat.Type.DIRECT)
        Membership.objects.create(chat=new_direct_chat, user=other_user)

        url = reverse("chat-join", args=[new_direct_chat.id])
        response = auth_client.post(url)
        assert response.status_code == 403

        # ===== CASE 3: Join to a topic chat where user is not a member=====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201
        topic_chat = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        url = reverse("chat-join", args=[topic_chat.id])
        response = other_auth_client.post(url)
        assert response.status_code == 400

        # ===== CASE 4: Join to a topic chat where user is a member=====
        url = reverse("chat-join", args=[topic_chat.id])
        response = auth_client.post(url)
        assert response.status_code == 400

    def test_leave_chat_success(self, other_auth_client, other_user, group_chat_with_user, channel_chat_with_user):
        """Chat member can leave GROUP/CHANNEL chat."""
        # ===== CASE 1: Leave a public group =====
        url = reverse("chat-join", args=[group_chat_with_user.id])
        other_auth_client.post(url)
        url = reverse("chat-leave", args=[group_chat_with_user.id])
        response = other_auth_client.post(url)

        assert response.status_code == 204
        assert not Membership.objects.filter(chat=group_chat_with_user, user=other_user).exists()

        # ===== CASE 2: Leave a public channel =====
        url = reverse("chat-join", args=[channel_chat_with_user.id])
        other_auth_client.post(url)
        url = reverse("chat-leave", args=[channel_chat_with_user.id])
        response = other_auth_client.post(url)

        assert response.status_code == 204
        assert not Membership.objects.filter(chat=channel_chat_with_user, user=other_user).exists()

    def test_owner_leave_chat_forbidden(self, auth_client, user, group_chat_with_user, channel_chat_with_user):
        """Chat owner cannot leave GROUP/CHANNEL chat."""
        # ===== CASE 1: Leave a public group =====
        url = reverse("chat-leave", args=[group_chat_with_user.id])
        response = auth_client.post(url)

        assert response.status_code == 403
        assert Membership.objects.filter(chat=group_chat_with_user, user=user).exists()

        # ===== CASE 2: Leave a public channel =====
        url = reverse("chat-leave", args=[channel_chat_with_user.id])
        response = auth_client.post(url)

        assert response.status_code == 403
        assert Membership.objects.filter(chat=channel_chat_with_user, user=user).exists()

    def test_leave_chat_forbidden(
        self, auth_client, other_auth_client, other_user, group_chat_with_user, channel_chat_with_user
    ):
        """User cannot leave DIRECT chats or TOPIC chats, and cannot leave chats they are not a member of."""
        # ===== CASE 1: Leave a direct chat where user is not a member =====
        new_direct_chat = Chat.objects.create(type=Chat.Type.DIRECT)
        Membership.objects.create(chat=new_direct_chat, user=other_user)

        url = reverse("chat-leave", args=[new_direct_chat.id])
        response = auth_client.post(url)
        assert response.status_code == 404

        # ===== CASE 2: Leave a direct chat where user is a member =====
        url = reverse("chat-leave", args=[new_direct_chat.id])
        response = other_auth_client.post(url)
        assert response.status_code == 403
        assert Membership.objects.filter(chat=new_direct_chat, user=other_user).exists()

        # ===== CASE 3: Leave a topic chat where user is not a member=====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201
        topic_chat = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        url = reverse("chat-leave", args=[topic_chat.id])
        response = other_auth_client.post(url)
        assert response.status_code == 404

        # ===== CASE 4: Leave a topic chat where user is a member=====
        url = reverse("chat-leave", args=[topic_chat.id])
        response = auth_client.post(url)
        assert response.status_code == 403
        assert Membership.objects.filter(chat=group_chat_with_user, user=auth_client.handler._force_user).exists()

        # ===== CASE 5: Leave a group/channel chat where user is not a member=====
        url = reverse("chat-leave", args=[group_chat_with_user.id])
        response = other_auth_client.post(url)
        assert response.status_code == 404

        url = reverse("chat-leave", args=[channel_chat_with_user.id])
        response = other_auth_client.post(url)
        assert response.status_code == 404

    def test_delete_chat_success(
        self, auth_client, other_auth_client, other_user, group_chat_with_user, channel_chat_with_user
    ):
        """Owners and admins can soft-delete topics, owners can soft-delete groups and channels."""
        # ===== CASE 1: Owners can delete a group/channel topic =====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201
        topic_chat = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        url = reverse("chat-detail", args=[topic_chat.id])
        response = auth_client.delete(url)
        assert response.status_code == 204
        assert Chat.objects.filter(id=topic_chat.id).exists()
        assert Chat.objects.filter(id=topic_chat.id).first().deleted_at is not None
        Chat.objects.filter(id=topic_chat.id).delete()

        # ===== CASE 2: Admins can delete a group/channel topic =====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201
        topic_chat = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        Membership.objects.create(chat=group_chat_with_user, user=other_user, role=Membership.Role.ADMIN)

        url = reverse("chat-detail", args=[topic_chat.id])
        response = other_auth_client.delete(url)
        assert response.status_code == 204
        assert Chat.objects.filter(id=topic_chat.id).exists()
        assert Chat.objects.filter(id=topic_chat.id).first().deleted_at is not None
        Chat.objects.filter(id=topic_chat.id).delete()

        # ===== CASE 3: Owners can delete a group/channel chats =====
        url = reverse("chat-detail", args=[group_chat_with_user.id])
        response = auth_client.delete(url)
        assert response.status_code == 204
        assert Chat.objects.filter(id=group_chat_with_user.id).exists()
        assert Chat.objects.filter(id=group_chat_with_user.id).first().deleted_at is not None

        url = reverse("chat-detail", args=[channel_chat_with_user.id])
        response = auth_client.delete(url)
        assert response.status_code == 204
        assert Chat.objects.filter(id=channel_chat_with_user.id).exists()
        assert Chat.objects.filter(id=channel_chat_with_user.id).first().deleted_at is not None

    def test_delete_chat_forbidden(
        self, auth_client, other_auth_client, other_user, group_chat_with_user, direct_chat_with_user_and_other
    ):
        """Non-members and non-owners cannot delete chats, topics, or direct chats."""
        # ===== CASE 1: User is not member =====
        url = reverse("chat-detail", args=[group_chat_with_user.id])
        response = other_auth_client.delete(url)
        assert response.status_code == 404

        # ===== CASE 2: removing direct chat =====
        url = reverse("chat-detail", args=[direct_chat_with_user_and_other.id])
        response = auth_client.delete(url)
        assert response.status_code == 403

        # ===== CASE 3: removing group/channel by non-owner =====
        Membership.objects.create(chat=group_chat_with_user, user=other_user, role=Membership.Role.ADMIN)

        url = reverse("chat-detail", args=[group_chat_with_user.id])
        response = other_auth_client.delete(url)
        assert response.status_code == 403

        Membership.objects.filter(chat=group_chat_with_user, user=other_user).update(role=Membership.Role.MEMBER)

        response = other_auth_client.delete(url)
        assert response.status_code == 403

        # ===== CASE 4: removing topic by ordinary member =====
        url = reverse("chat-list")
        data = {"type": Chat.Type.TOPIC, "title": "My New Group Topic", "parent": group_chat_with_user.id}
        response = auth_client.post(url, data)
        assert response.status_code == 201

        topic = Chat.objects.filter(type=Chat.Type.TOPIC).first()

        url = reverse("chat-detail", args=[topic.id])
        response = other_auth_client.delete(url)
        assert response.status_code == 403

    def test_update_chat_success(self, auth_client, other_auth_client, other_user, group_chat_with_user):
        """Owners and admins can update group/channel/topic titles."""
        url = reverse("chat-detail", args=[group_chat_with_user.id])
        data = {"title": "Updated Title"}

        # ===== CASE 1: Owner can update =====
        response = auth_client.patch(url, data)
        assert response.status_code == 200
        group_chat_with_user.refresh_from_db()
        assert group_chat_with_user.title == "Updated Title"

        # ===== CASE 2: Admin can update =====
        Membership.objects.create(chat=group_chat_with_user, user=other_user, role=Membership.Role.ADMIN)
        response = other_auth_client.patch(url, {"title": "Updated by Admin"})
        assert response.status_code == 200
        group_chat_with_user.refresh_from_db()
        assert group_chat_with_user.title == "Updated by Admin"

    def test_update_chat_forbidden(
        self, auth_client, other_auth_client, other_user, group_chat_with_user, direct_chat_with_user_and_other
    ):
        """Non-members, non-admins, and direct chats cannot be updated."""
        # ===== CASE 1: Not a member =====
        url = reverse("chat-detail", args=[group_chat_with_user.id])
        response = other_auth_client.patch(url, {"title": "Hacked"})
        assert response.status_code == 404

        # ===== CASE 2: Direct chat =====
        url = reverse("chat-detail", args=[direct_chat_with_user_and_other.id])
        response = auth_client.patch(url, {"title": "Hacked"})
        assert response.status_code == 403

        # ===== CASE 3: Ordinary member =====
        Membership.objects.create(chat=group_chat_with_user, user=other_user, role=Membership.Role.MEMBER)
        url = reverse("chat-detail", args=[group_chat_with_user.id])
        response = other_auth_client.patch(url, {"title": "Hacked"})
        assert response.status_code == 403

    def test_get_chat_messages_success(self, auth_client, user, other_user, group_chat_with_user):
        """Chat member can get messages from chat."""
        Membership.objects.create(chat=group_chat_with_user, user=other_user)

        Message.objects.create(chat=group_chat_with_user, sender=user, text="Msg 1")
        Message.objects.create(chat=group_chat_with_user, sender=other_user, text="Msg 2")

        deleted_msg = Message.objects.create(chat=group_chat_with_user, sender=user, text="Deleted")
        deleted_msg.deleted_at = "2026-10-19T00:00:00Z"
        deleted_msg.save()

        url = reverse("chat-messages", args=[group_chat_with_user.id])
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
