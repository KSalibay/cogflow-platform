# CogFlow Researcher API

This document lists researcher-facing authenticated endpoints.

## Audience

- Portal and Builder integration developers
- Researcher workflow maintainers
- Support and onboarding engineers

## Auth and Session

- `POST /api/v1/auth/csrf`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/register/verify`
- `POST /api/v1/auth/password/reset/request`
- `POST /api/v1/auth/password/reset/confirm`
- `POST /api/v1/auth/password/change`

## MFA

- `POST /api/v1/auth/mfa/setup`
- `POST /api/v1/auth/mfa/verify`
- `POST /api/v1/auth/mfa/disable`

## Studies and Collaboration

- `GET /api/v1/studies`
- `POST /api/v1/configs/publish`
- `POST /api/v1/studies/<study_slug>/participant-links`
- `POST /api/v1/studies/<study_slug>/owner`
- `POST /api/v1/studies/<study_slug>/share`
- `POST /api/v1/studies/<study_slug>/share/validate-user`
- `POST /api/v1/studies/<study_slug>/share/remove`
- `POST /api/v1/studies/<study_slug>/duplicate`
- `POST /api/v1/studies/<study_slug>/delete`
- `POST /api/v1/studies/<study_slug>/configs/<config_version_id>/delete`
- `GET /api/v1/studies/<study_slug>/runs`
- `GET /api/v1/studies/<study_slug>/latest-config`
- `POST /api/v1/studies/<study_slug>/properties`
- `POST /api/v1/studies/<study_slug>/take-to-go`

### SONA External Study

In the portal's Integrations view, choose the study and generate its SONA Study URL.
Paste that URL, including the literal `%SURVEY_CODE%`, into SONA's Study URL field.
Once SONA provides its server-side completion URL, paste it into CogFlow and
generate again. The Study URL stays the same; only its signed launch policy is
refreshed. Regenerate before expiry to extend the link without updating SONA.

API clients can send `sona_short_link: true` to `participant-links` to receive
`sona_study_url` (a short multi-use URL). `completion_redirect_url` is optional
on the first request. CogFlow replaces `%SURVEY_CODE%` in a supplied SONA
completion URL with the participant's code at run completion. The public
`GET /s/<code>?survey_code=<participant-code>` endpoint resolves the alias to
the signed, expiring launch token; it rejects missing survey codes and expired
links. Do not truncate a signed `launch` token to meet SONA's URL limit.

## Assets

- `POST /api/v1/assets/upload`
- `GET /api/v1/assets/file/<asset_path>`

## Analysis and Reporting

- `POST /api/v1/studies/analysis/report`
- `GET /api/v1/studies/analysis/jobs`
- `GET /api/v1/studies/analysis/jobs/<job_id>`
- `GET /api/v1/studies/analysis/jobs/<job_id>/artifacts/<artifact_format>`
- `POST /api/v1/studies/analysis/jobs/<job_id>/cancel`
- `POST /api/v1/studies/analysis/jobs/<job_id>/delete`

## Other Researcher Endpoints

- `POST /api/v1/feedback/submit`
- `GET /api/v1/credits`
- `POST /api/v1/results/decrypt` (requires authenticated session and MFA verification)

## Publication Guidance

This page can be published publicly only if sensitive operational details are redacted.
Prefer publishing a reduced subset to public docs and keeping the full researcher contract in repo/internal docs.

## Schema Reference

Use `docs/openapi.json` as the canonical field-level contract.

Builder/Interpreter runtime schema contract:

- `docs/API_SCHEMAS.md`

Contribution process and task onboarding workflow:

- `docs/CONTRIBUTOR_GUIDE.md`
