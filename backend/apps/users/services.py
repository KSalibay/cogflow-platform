from django.contrib.auth.models import User

from apps.users.models import UserProfile


def get_or_create_profile(user: User) -> UserProfile:
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile
