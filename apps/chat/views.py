from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .models import Chat


@login_required
def index(request):
    chats = Chat.objects.for_user(request.user)
    chats_data = []

    for chat in chats:
        display_title = chat.title
        if chat.type == Chat.Type.DIRECT and not display_title:
            other_membership = chat.memberships.exclude(user=request.user).first()
            if other_membership:
                display_title = other_membership.user.public_name
            else:
                display_title = "Удаленный пользователь"

        chats_data.append(
            {
                "id": chat.id,
                "type_display": chat.get_type_display(),
                "display_title": display_title,
                "first_letter": display_title[0].upper() if display_title else "?",
            }
        )

    context = {
        "chats": chats_data,
    }
    return render(request, "chat/index.html", context)
