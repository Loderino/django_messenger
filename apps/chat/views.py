from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .models import Chat


@login_required
def index(request):
    chats = Chat.objects.for_user(request.user)
    chats_data = []

    for chat in chats:
        display_title = chat.get_display_title(request.user)
        avatar_url = None

        if chat.type == Chat.Type.DIRECT:
            other_member = chat.memberships.exclude(user=request.user).first()
            if other_member:
                avatar_url = other_member.user.avatar_url

        chats_data.append(
            {
                "id": chat.id,
                "type": chat.type,
                "type_display": chat.get_type_display(),
                "display_title": display_title,
                "first_letter": display_title[0].upper() if display_title else "?",
                "avatar_url": chat.avatar.url if chat.avatar else avatar_url,
            }
        )

    return render(request, "chat/index.html", {"chats": chats_data})
