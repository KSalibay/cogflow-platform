# CogFlow Platform Backend

Django backend for CogFlow Platform, including authentication, studies lifecycle,
runtime launch, results ingestion, and reporting workflows.

## Core Endpoint Groups

- Health and schema:
  - `GET /healthz`
  - `GET /api/schema`
- Auth and MFA:
  - `/api/v1/auth/*`
- Researcher study workflows:
  - `/api/v1/studies*`
  - `POST /api/v1/configs/publish`
  - `/api/v1/assets/*`
- Interpreter runtime:
  - `POST /api/v1/runs/start`
  - `POST /api/v1/results/submit`
  - `POST /api/v1/results/decrypt`
- Internal admin:
  - `/api/v1/admin/*`

## Local Setup

1. Copy `.env.example` to `.env` at repository root.
2. Start local services: `docker compose up -d --build`
3. Verify health: `curl -f http://127.0.0.1:8000/healthz`

## API Contract Maintenance

Regenerate checked-in OpenAPI whenever API behavior changes:

```bash
./scripts/generate_openapi.sh
```

See docs:
- `docs/API.md`
- `docs/API_PUBLIC.md`
- `docs/API_RESEARCHER.md`
- `docs/API_ADMIN_INTERNAL.md`
- `docs/DOCS_MAINTENANCE.md`

## Security Notes

- Admin operations are internal and require strict RBAC checks.
- MFA should be enforced for privileged operations.
- Decrypt/read operations are audited and require authenticated access with MFA verification.
