# CogFlow Admin API (Internal)

Status: internal documentation only. Do not publish this page on public websites.

## Audience

- Platform operators
- Trusted maintainers and contributors

## Admin Endpoints

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/<user_id>/password`
- `POST /api/v1/admin/users/<user_id>/role`
- `POST /api/v1/admin/users/<user_id>/activation`
- `POST /api/v1/admin/users/<user_id>/delete`

## Security Requirements

- Server-side RBAC checks are mandatory.
- Require authenticated admin session for all admin routes.
- Strongly recommended: enforce MFA for admin sessions and step-up MFA for destructive actions.
- Log all admin changes to audit trails.

## Publication Policy

- Keep this document in internal-only docs scope.
- Public docs should not include admin endpoint details.

## UX Guidance

- Admin tools should be discoverable only after admin login in portal UI.
- For sensitive actions (delete/reset/role change), use explicit confirmation and recent MFA verification.

## Schema Reference

Use `docs/openapi.json` with internal filtering for admin paths.
