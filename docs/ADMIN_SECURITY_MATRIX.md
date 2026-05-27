# Admin Action Security Matrix

This matrix defines minimum control requirements by action type.

| Action class | Example endpoints/actions | Admin role required | MFA required | Step-up MFA required | Audit required |
|---|---|---|---|---|---|
| Read admin data | `GET /api/v1/admin/users` | Yes | Yes | No | Yes |
| Change user role | `POST /api/v1/admin/users/<user_id>/role` | Yes | Yes | Yes | Yes |
| Change activation state | `POST /api/v1/admin/users/<user_id>/activation` | Yes | Yes | Yes | Yes |
| Reset/change credentials | `POST /api/v1/admin/users/<user_id>/password` | Yes | Yes | Yes | Yes |
| Delete user | `POST /api/v1/admin/users/<user_id>/delete` | Yes | Yes | Yes | Yes |
| Reassign study owner | `POST /api/v1/studies/<study_slug>/owner` | Yes (or delegated scope) | Yes | Yes | Yes |
| Delete study/config | `POST /api/v1/studies/<study_slug>/delete`, `POST /api/v1/studies/<study_slug>/configs/<config_version_id>/delete` | Yes (or delegated scope) | Yes | Yes | Yes |

## UX Defaults

- Sensitive actions should prompt a confirmation modal with resource name and impact summary.
- If step-up MFA is stale, prompt for MFA challenge inline before final submit.
- On completion, show success/failure with audit trace identifier where possible.

## Notes

- Exact role model can evolve, but the minimum control floor above should not be weakened.
- Endpoint-level permissions should remain backend-enforced even if UI routes are hidden.
