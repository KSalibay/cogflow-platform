# Backend Vertical Slice

This backend provides the first vertical-slice APIs for the new CogFlow Platform architecture.

## Included Endpoints

- GET /healthz
- GET /api/v1/studies
- POST /api/v1/configs/publish
- POST /api/v1/runs/start
- POST /api/v1/results/submit

## Local Setup

1. Copy .env.example to .env at repository root.
2. Start local services with docker compose.
3. Run migrations in the API container.

## Commands

```powershell
docker compose up -d --build
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate
docker compose exec api python manage.py createsuperuser
```

## Vertical Slice Demo Order

1. Open frontend/builder/publish_stub.html and publish demo config.
2. Open frontend/portal/index.html and refresh studies.
3. Open frontend/interpreter/runtime_stub.html, start run, and submit result.
4. Refresh portal to confirm run count changed.

## Notes

- Encryption and hashing utilities are development-safe placeholders and must be hardened with managed keys.
- Authentication is intentionally permissive for the first local vertical slice.
