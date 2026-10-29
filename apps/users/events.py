from enum import IntEnum, StrEnum


class WSEvent(StrEnum):
    """
    WebSocket events
    """

    CHAT_MESSAGE_NEW = "chat.message.new"
    CHAT_MESSAGE_DELETED = "chat.message.deleted"
    CHAT_MESSAGE_UPDATED = "chat.message.updated"
    CHAT_MESSAGE_READ = "chat.message.read"

    CHAT_DIRECT_CREATED = "chat.direct.created"
    CHAT_TOPIC_CREATED = "chat.topic.created"
    CHAT_STATE_UPDATED = "chat.state.updated"
    CHAT_STATE_DELETED = "chat.state.deleted"

    CHAT_MEMBER_JOINED = "chat.member.joined"
    CHAT_MEMBER_LEFT = "chat.member.left"


class WSCloseCode(IntEnum):
    """WebSocket closing custom codes"""

    UNAUTHORIZED = 4001
    FORBIDDEN = 4003
