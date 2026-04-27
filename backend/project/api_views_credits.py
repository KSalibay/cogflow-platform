from .api_views_common import *

class CreditsView(APIView):
    """Fetch/update CRediT assignments grouped by task scopes."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        schema_set = set(SCHEMA_COMPONENT_TYPES)
        task_scopes = []
        task_scope_map = {}
        for row in TASK_SCOPE_DEFINITIONS:
            task_type = str(row["task_type"])
            components = [c for c in row["components"] if c in schema_set]
            task_scopes.append({"task_type": task_type, "components": components})
            task_scope_map[task_type] = set(components)

        rows = []
        for x in TaskCreditRow.objects.select_related("updated_by").all():
            rows.append(
                {
                    "id": x.id,
                    "task_type": x.task_type,
                    "component_type": x.component_type,
                    "credit_role": x.credit_role,
                    "contributor_username": x.contributor_username,
                    "notes": x.notes,
                    "updated_by": (x.updated_by.username if x.updated_by else None),
                    "updated_at": x.updated_at,
                }
            )

        usernames = list(
            User.objects.filter(is_active=True)
            .order_by("username")
            .values_list("username", flat=True)
        )

        return Response(
            {
                "ok": True,
                "schema_source": "docs/reference/plugins/plugin_schema_reference.md",
                "component_count": len(SCHEMA_COMPONENT_TYPES),
                "schema_components": SCHEMA_COMPONENT_TYPES,
                "task_scopes": task_scopes,
                "credit_roles": CREDIT_ROLES,
                "usernames": usernames,
                "entries": rows,
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = CreditsBulkUpdateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entries = serializer.validated_data["entries"]

        schema_set = set(SCHEMA_COMPONENT_TYPES)
        valid_task_scopes = {
            str(x["task_type"]): set(c for c in x["components"] if c in schema_set)
            for x in TASK_SCOPE_DEFINITIONS
        }
        credit_roles_set = set(CREDIT_ROLES)
        active_users = set(
            User.objects.filter(is_active=True).values_list("username", flat=True)
        )

        unknown_task_types = sorted(
            {
                str(e.get("task_type", "")).strip()
                for e in entries
                if str(e.get("task_type", "")).strip() not in valid_task_scopes
            }
        )
        if unknown_task_types:
            return Response(
                {
                    "error": "Unknown task_type values",
                    "unknown": unknown_task_types,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        unknown = sorted(
            {
                str(e.get("component_type", "")).strip()
                for e in entries
                if str(e.get("component_type", "")).strip() not in schema_set
            }
        )
        if unknown:
            return Response(
                {
                    "error": "Unknown component_type values",
                    "unknown": unknown,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invalid_task_scope_pairs = []
        unknown_roles = sorted(
            {
                str(e.get("credit_role", "")).strip()
                for e in entries
                if str(e.get("credit_role", "")).strip() not in credit_roles_set
            }
        )
        if unknown_roles:
            return Response(
                {
                    "error": "Unknown credit_role values",
                    "unknown": unknown_roles,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        unknown_users = sorted(
            {
                str(e.get("contributor_username", "")).strip()
                for e in entries
                if str(e.get("contributor_username", "")).strip() not in active_users
            }
        )
        if unknown_users:
            return Response(
                {
                    "error": "Unknown contributor_username values",
                    "unknown": unknown_users,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        prepared = []
        for entry in entries:
            task_type = str(entry.get("task_type", "") or "").strip()
            component_type = str(entry.get("component_type", "")).strip()
            if component_type not in valid_task_scopes.get(task_type, set()):
                invalid_task_scope_pairs.append(
                    {
                        "task_type": task_type,
                        "component_type": component_type,
                    }
                )
                continue
            prepared.append(
                TaskCreditRow(
                    task_type=task_type,
                    component_type=component_type,
                    credit_role=str(entry.get("credit_role", "") or "").strip(),
                    contributor_username=str(entry.get("contributor_username", "") or "").strip(),
                    notes=str(entry.get("notes", "") or "").strip(),
                    updated_by=request.user,
                )
            )

        if invalid_task_scope_pairs:
            return Response(
                {
                    "error": "component_type is not valid for the selected task_type",
                    "invalid_pairs": invalid_task_scope_pairs,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        TaskCreditRow.objects.all().delete()
        if prepared:
            TaskCreditRow.objects.bulk_create(prepared)
        updated = len(prepared)

        record_audit(
            action="credits_updated",
            resource_type="credits",
            resource_id="task-credit-rows",
            actor=request.user.username,
            metadata={"updated_count": updated},
        )

        return Response({"ok": True, "updated_count": updated}, status=status.HTTP_200_OK)


