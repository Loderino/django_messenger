from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .models import Chat


@login_required
def index(request):
    chats = Chat.objects.for_user(request.user)
    chats_data = []

    for chat in chats:
        display_title = chat.get_display_title(request.user)

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
