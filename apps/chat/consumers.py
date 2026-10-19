import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .events import WSCloseCode, WSEvent
from .models import Chat, Membership


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        self.chat_id = self.scope["url_route"]["kwargs"]["chat_id"]
        self.room_group_name = f"chat_{self.chat_id}"

        if not self.user.is_authenticated:
            await self.close(code=WSCloseCode.UNAUTHORIZED)
            return

        is_member = await self.check_membership()
        if not is_member:
            await self.close(code=WSCloseCode.FORBIDDEN)
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    @database_sync_to_async
    def check_membership(self):
        try:
            chat = Chat.objects.get(id=self.chat_id)
        except Chat.DoesNotExist:
            return False

        if chat.type == Chat.Type.TOPIC:
            if not chat.parent:
                return False
            return Membership.objects.filter(chat=chat.parent, user=self.user).exists()
        return Membership.objects.filter(chat=chat, user=self.user).exists()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({"type": WSEvent.MESSAGE_NEW, "data": event["message"]}))
