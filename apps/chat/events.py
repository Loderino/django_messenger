from enum import IntEnum, StrEnum


class WSEvent(StrEnum):
    """
    WebSocket events
    """

    MESSAGE_NEW = "message.new"


class WSCloseCode(IntEnum):
    """WebSocket closing custom codes"""

    UNAUTHORIZED = 4001
    FORBIDDEN = 4003
