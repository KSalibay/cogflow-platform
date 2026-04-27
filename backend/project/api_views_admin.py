from .api_views_common import *

class AdminUsersView(APIView):
    """List and create platform users (platform_admin only)."""

    @transaction.atomic
    def get(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        users = []
        for user in User.objects.all().order_by("username"):
            profile = get_or_create_profile(user)
            users.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "is_active": user.is_active,
                    "is_superuser": user.is_superuser,
                    "role": profile.role,
                    "mfa_enabled": profile.mfa_enabled,
                    "last_login": user.last_login,
                    "date_joined": user.date_joined,
                }
            )

        return Response({"users": users}, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminCreateUserRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        username = data["username"].strip()
        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already exists"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            username=username,
            password=data["password"],
            email=(data.get("email") or "").strip(),
        )
        user.is_active = data.get("is_active", True)
        user.save(update_fields=["is_active"])

        profile = get_or_create_profile(user)
        profile.role = data["role"]
        profile.save(update_fields=["role"])

        record_audit(
            action="admin_user_created",
            resource_type="user",
            resource_id=user.id,
            actor=request.user.username,
            metadata={"username": user.username, "role": profile.role},
        )

        return Response(
            {
                "ok": True,
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "is_active": user.is_active,
                    "role": profile.role,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class AdminUserRoleView(APIView):
    """Update an existing user's role (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminUpdateUserRoleRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data["role"]

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(target)
        profile.role = role
        profile.save(update_fields=["role"])

        record_audit(
            action="admin_user_role_updated",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username, "role": role},
        )

        return Response(
            {"ok": True, "user": {"id": target.id, "username": target.username, "role": profile.role}},
            status=status.HTTP_200_OK,
        )


class AdminUserDeleteView(APIView):
    """Delete a user account (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        if request.user.id == user_id:
            return Response({"error": "You cannot delete your own account"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        username = target.username
        target.delete()

        record_audit(
            action="admin_user_deleted",
            resource_type="user",
            resource_id=user_id,
            actor=request.user.username,
            metadata={"username": username},
        )

        return Response({"ok": True}, status=status.HTTP_200_OK)


class AdminUserActivationView(APIView):
    """Activate or deactivate a user account (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminUpdateUserActivationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_active = serializer.validated_data["is_active"]

        if request.user.id == user_id and not is_active:
            return Response({"error": "You cannot deactivate your own account"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        target.is_active = is_active
        target.save(update_fields=["is_active"])

        record_audit(
            action="admin_user_activation_updated",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username, "is_active": is_active},
        )

        return Response(
            {
                "ok": True,
                "user": {
                    "id": target.id,
                    "username": target.username,
                    "is_active": target.is_active,
                },
            },
            status=status.HTTP_200_OK,
        )


class AdminUserPasswordView(APIView):
    """Allow platform admins to set a new temporary password for any user."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminSetUserPasswordRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_password = serializer.validated_data["new_password"]

        if len(new_password) < 8:
            return Response({"error": "Password must be at least 8 characters"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        target.set_password(new_password)
        target.save(update_fields=["password"])

        record_audit(
            action="admin_user_password_reset",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username},
        )

        return Response(
            {"ok": True, "user": {"id": target.id, "username": target.username}},
            status=status.HTTP_200_OK,
        )


