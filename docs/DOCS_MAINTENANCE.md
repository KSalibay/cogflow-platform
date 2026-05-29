# CogFlow Docs Maintenance Policy

This file defines when documentation updates are required, and when a full audit
is not required.

## Canonical API Source

- Canonical API schema artifact: `docs/openapi.json`
- Generation command: `./scripts/generate_openapi.sh`
- The schema file is generated, not hand-maintained.

## Documentation Scopes

- Public-public website copy: `docs/site-public/*`
- Public technical docs: `docs/API_PUBLIC.md` and approved portions of `docs/API_RESEARCHER.md`
- Runtime schema docs: `docs/API_SCHEMAS.md`
- Internal docs: admin/security docs such as `docs/API_ADMIN_INTERNAL.md`, `docs/ADMIN_SECURITY_POLICY.md`, and `docs/ADMIN_SECURITY_MATRIX.md`
- Contributor process docs: `docs/CONTRIBUTOR_GUIDE.md`

## Update Triggers

### No full audit required (patch-only docs updates)

Apply focused docs updates only when all changes are bug-fix scope and do not
change external behavior:

- Internal refactors with no endpoint, payload, or UI workflow change
- Bug fixes that preserve existing API contracts and user flows
- Styling/content typo fixes in docs
- Small wording-only updates to public-public website copy that do not change product claims

### Targeted docs updates required

Update the relevant docs pages when any of the following changes happen:

- Any new endpoint, removed endpoint, or endpoint path change
- Request/response shape change (fields, requiredness, error codes)
- Auth/permission behavior change
- Builder/Interpreter integration behavior change
- Deployment, env var, or runtime contract change
- Any change to privacy/security claims, backup posture, or data governance messaging in public-public pages

Minimum required update set:

1. Regenerate `docs/openapi.json`
2. Update `docs/API.md` summary sections if behavior changed
3. Update `docs/API_SCHEMAS.md` if Builder/Interpreter schema contracts changed
4. Update any app README sections affected by runtime changes

## Release Cadence

- Per feature PR: apply targeted docs updates in the same PR
- Weekly: quick docs drift check (OpenAPI generation + spot-check links)
- Monthly: docs quality sweep for navigation, stale examples, and release notes
- Per beta/RC tag: full docs review and publication check

## CI/Review Gate (Recommended)

- PR reviewers should reject API-affecting changes without updated schema/docs.
- Keep generated OpenAPI committed so website and GitHub docs stay aligned.

## Admin Endpoint Publication Policy

Admin endpoints should be access-controlled in the product and clearly marked as
internal in docs. Prefer one repository with split publication scopes:

- Public website docs: public + researcher-safe API docs only
- Internal docs set: admin endpoints and operational procedures

Do not rely on endpoint obscurity for security; enforce server-side authz.