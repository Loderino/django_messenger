import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator

from apps.chat.events import WSCloseCode, WSEvent
from apps.chat.models import Chat, Membership
from config.asgi import application


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
class TestChatConsumer:
    async def test_connect_unauthorized(self):
        """Anonymous user cannot connect."""
        communicator = WebsocketCommunicator(application, "/ws/chat/1/")
        connected, close_code = await communicator.connect()

        assert not connected
        assert close_code == WSCloseCode.UNAUTHORIZED

        await communicator.disconnect()

    async def test_connect_forbidden(self, user, other_user):
        """User cannot connect to a chat they are not a member of."""
        chat = await database_sync_to_async(Chat.objects.create)(type=Chat.Type.GROUP, title="Test")
        await database_sync_to_async(Membership.objects.create)(chat=chat, user=other_user)

        communicator = WebsocketCommunicator(application, f"/ws/chat/{chat.id}/")
        communicator.scope["user"] = user
        connected, close_code = await communicator.connect()

        assert not connected
        assert close_code == WSCloseCode.FORBIDDEN

        await communicator.disconnect()

    async def test_connect_and_receive_message(self, user, group_chat_with_user):
        """Member can connect and receive broadcasted message."""
        communicator = WebsocketCommunicator(application, f"/ws/chat/{group_chat_with_user.id}/")
        communicator.scope["user"] = user

        connected, _ = await communicator.connect()
        assert connected

        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"chat_{group_chat_with_user.id}",
            {
                "type": "chat_message",
                "message": {
                    "id": 1,
                    "text": "Hello WebSocket",
                    "sender_name": user.username,
                    "created_at": "2026-10-20T12:00:00Z",
                },
            },
        )
        response = await communicator.receive_json_from()

        assert response["type"] == WSEvent.MESSAGE_NEW
        assert response["data"]["text"] == "Hello WebSocket"

        await communicator.disconnect()

    async def test_connect_to_topic(self, user, group_chat_with_user):
        """Member of the parent group can connect to a topic."""
        topic = await database_sync_to_async(Chat.objects.create)(
            type=Chat.Type.TOPIC, title="Test Topic", parent=group_chat_with_user
        )

        communicator = WebsocketCommunicator(application, f"/ws/chat/{topic.id}/")
        communicator.scope["user"] = user

        connected, _ = await communicator.connect()

        assert connected
        await communicator.disconnect()
