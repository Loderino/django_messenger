from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import api

router = DefaultRouter()
router.register(r"users", api.UserViewSet, basename="user")

urlpatterns = [
    path("", include(router.urls)),
]
