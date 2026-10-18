from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import api

router = DefaultRouter()

router.register(r"chats", api.ChatViewSet, basename="chat")
router.register(r"messages", api.MessageViewSet, basename="message")

urlpatterns = [
    path("", include(router.urls)),
]
