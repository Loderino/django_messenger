from .base import *

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
    }
}
