from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.chat import views as chat_views
from apps.users import views as users_views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("api/", include("apps.chat.urls")),
    path("api/", include("apps.users.urls")),
    path("chats/", chat_views.index, name="index"),
    path("user/<str:identifier>/", users_views.profile, name="profile"),
    path("", RedirectView.as_view(pattern_name="index", permanent=False)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("favicon.ico", RedirectView.as_view(url="/static/images/favicon.png", permanent=True)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
