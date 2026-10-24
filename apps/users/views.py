from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.shortcuts import get_object_or_404, render

from .models import User


@login_required
def profile(request, identifier):
    q = Q(display_name=identifier)
    if identifier.isdigit():
        q |= Q(id=identifier)
    user = get_object_or_404(User, q)
    is_self = request.user.id == user.id

    context = {
        "profile_user": user,
        "display_name": user.display_name,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "last_seen": user.last_seen,
        "is_online": True if is_self else False,
        "is_self": is_self,
    }
    if is_self:
        context.update({"username": user.username, "display_name": user.display_name, "avatar": user.avatar})
    return render(request, "users/profile.html", context)
