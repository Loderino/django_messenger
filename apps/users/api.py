from typing import ClassVar

from django.contrib.auth import get_user_model
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

User = get_user_model()


class UserViewSet(viewsets.GenericViewSet):
    permission_classes: ClassVar[list[permissions.BasePermission]] = [permissions.IsAuthenticated]

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
        users = User.objects.filter(Q(username__icontains=query) | Q(display_name__icontains=query)).exclude(
            id=request.user.id
        )[:10]

        data = [
            {
                "id": u.id,
                "public_name": u.public_name,
                "username": u.username,
                "avatar_url": u.avatar_url,
            }
            for u in users
        ]
        return Response(data)
