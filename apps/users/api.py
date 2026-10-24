from typing import ClassVar

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .serializers import UserProfileSerializer

User = get_user_model()


class UserViewSet(
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]
    serializer_class = UserProfileSerializer

    def get_queryset(self):
        queryset = User.objects.all()
        display_name = self.request.query_params.get("display_name", None)
        if display_name is not None:
            queryset = queryset.filter(display_name=display_name)
        return queryset

    def get_object(self):
        lookup = self.kwargs.get(self.lookup_field)
        queryset = self.filter_queryset(self.get_queryset())
        obj = get_object_or_404(queryset, Q(display_name=lookup) | Q(id=lookup))
        self.check_object_permissions(self.request, obj)
        return obj

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="display_name",
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
                description="Filter users by exact display name",
            )
        ]
    )
    def list(self, request, *args, **kwargs):
        if "display_name" not in request.query_params:
            if not (request.user.is_staff or request.user.is_superuser):
                raise PermissionDenied("Only admins can view the full user list.")
        return mixins.ListModelMixin.list(self, request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def perform_update(self, serializer):
        if serializer.instance.id != self.request.user.id:
            raise PermissionDenied("You can only edit your own profile.")
        serializer.save()

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="q", type=OpenApiTypes.STR, location=OpenApiParameter.QUERY, description="Search query string"
            )
        ]
    )
    @action(detail=False, methods=["get"])
    def search(self, request):
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response({"detail": "Query parameter 'q' is required."}, status=400)
        users = User.objects.filter(Q(display_name__icontains=query)).exclude(id=request.user.id)[:10]

        data = [
            {
                "id": u.id,
                "display_name": u.display_name,
                "username": u.username,
                "avatar_url": u.avatar_url,
            }
            for u in users
        ]
        return Response(data)

    @action(detail=False, methods=["get"])
    def check_name(self, request):
        name = request.query_params.get("name", "").strip()
        if not name:
            return Response({"available": False, "detail": "Name is required."}, status=400)

        # Исключаем текущего пользователя, чтобы он не блокировал сам себя
        is_taken = User.objects.filter(display_name__iexact=name).exclude(id=request.user.id).exists()
        return Response({"available": not is_taken})
