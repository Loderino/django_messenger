import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.chat.models import Chat

from .events import WSCloseCode, WSEvent


class UserConsumer(AsyncWebsocketConsumer):
    @database_sync_to_async
    def get_user_chats(self):
        return list(Chat.objects.for_user_with_topics(self.user))

    async def connect(self):
        self.user = self.scope["user"]

        if not self.user.is_authenticated:
            await self.close(code=WSCloseCode.UNAUTHORIZED)
            return

        self.user_group = f"user_{self.user.id}"
        self.chat_groups = set()

        chats = await self.get_user_chats()

        await self.channel_layer.group_add(self.user_group, self.channel_name)

        for chat in chats:
            group_name = f"chat_{chat.id}"
            await self.channel_layer.group_add(group_name, self.channel_name)
            self.chat_groups.add(group_name)

        await self.accept()

    @database_sync_to_async
    def mark_messages_read(self, chat_id):
        from apps.chat.models import Message

        Message.objects.filter(chat_id=chat_id, is_read=False).exclude(sender=self.user).update(is_read=True)

    async def disconnect(self, close_code):
        if hasattr(self, "user_group"):
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

        if hasattr(self, "chat_groups"):
            for group_name in self.chat_groups:
                await self.channel_layer.group_discard(group_name, self.channel_name)

    async def join_chat_group(self, event):
        group_name = f"chat_{event['payload']['chat_id']}"
        await self.channel_layer.group_add(group_name, self.channel_name)
        self.chat_groups.add(group_name)

    async def leave_chat_group(self, event):
        group_name = f"chat_{event['payload']['chat_id']}"
        await self.channel_layer.group_discard(group_name, self.channel_name)
        self.chat_groups.discard(group_name)

    async def chat_member_joined(self, event):
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_MEMBER_JOINED, "payload": event["payload"]}))

    async def chat_member_left(self, event):
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_MEMBER_LEFT, "payload": event["payload"]}))

    async def chat_direct_created(self, event):
        group_name = f"chat_{event['payload']['chat']['id']}"
        await self.channel_layer.group_add(group_name, self.channel_name)
        self.chat_groups.add(group_name)
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_DIRECT_CREATED, "payload": event["payload"]}))

    async def chat_topic_created(self, event):
        group_name = f"chat_{event['payload']['chat']['id']}"
        await self.channel_layer.group_add(group_name, self.channel_name)
        self.chat_groups.add(group_name)
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_TOPIC_CREATED, "payload": event["payload"]}))

    async def chat_deleted(self, event):
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_STATE_DELETED, "payload": event["payload"]}))

        await self.leave_chat_group(event)

    async def chat_message_new(self, event):
        await self.send(text_data=json.dumps({"type": WSEvent.CHAT_MESSAGE_NEW, "payload": event["payload"]}))
