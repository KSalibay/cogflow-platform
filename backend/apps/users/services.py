from django.contrib.auth.models import User

from apps.users.models import UserProfile


def get_or_create_profile(user: User) -> UserProfile:
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def get_public_name(user: User) -> str:
    profile = get_or_create_profile(user)
    public_name = (profile.public_name or "").strip()
    if public_name:
        return public_name
    full = (f"{user.first_name} {user.last_name}").strip()
    if full:
        return full
    return user.username
