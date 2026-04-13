# CogFlow Platform Deployment

## Deployment Goal

The platform should be deployable in two modes:
- Local development with Docker Compose
- Staging/production on Kubernetes

The deployment model should prioritize reproducibility, observability, and rollback safety over premature complexity.

## Environment Profiles

### Local
Used for rapid development and vertical-slice testing.

Expected components:
- Django API
- Background worker
- PostgreSQL
- MinIO
- Optional Redis

### Day 1 Local Stack (Current)

This repository provides a local Docker Compose stack for the Week 1 vertical slice:

- `api` (Django)
- `db` (PostgreSQL 16)
- `minio` (S3-compatible object storage)
- `redis` (optional queue/cache baseline)

Quick start:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Health checks:

```bash
curl -f http://127.0.0.1:8000/healthz
curl -f http://127.0.0.1:9000/minio/health/live
```

Expected local URLs:

- API: `http://127.0.0.1:8000`
- MinIO API: `http://127.0.0.1:9000`
- MinIO Console: `http://127.0.0.1:9001`

Notes:

- API container runs migrations on startup before launching Django dev server.
- Database data persists in Docker volume `pgdata`.
- Object storage data persists in Docker volume `miniodata`.

### Known Host Issue: Docker iptables Isolation Chain

On some Linux hosts, `docker compose up` can fail with an error similar to:

`Chain 'DOCKER-ISOLATION-STAGE-2' does not exist`

This is a host Docker/networking issue, not a CogFlow compose file issue.

Recommended recovery path:

1. Restart Docker daemon/service.
2. Re-run `docker compose up -d --build`.
3. If still failing, reboot host or repair Docker iptables integration according to distro guidance.

Avoid repository-level workarounds for this error; fix the host networking state first.

### Staging
Used for integration, end-to-end tests, and pilot validation.

Expected components:
- Kubernetes deployment for API and worker
- Managed or stateful PostgreSQL
- S3-compatible object storage
- TLS-enabled ingress
- Centralized logs and metrics

### Production
Used for real researcher workflows.

Expected additions:
- Backup and restore automation
- Alerting and incident response wiring
- Secret rotation procedures
- Defined rollback playbooks

## Containerized Services

### API service
- Hosts Django app and researcher-facing API
- Exposes `healthz` and `readyz`
- Runs schema migrations during controlled deployment step, not inside the request path

### Worker service
- Processes asynchronous jobs such as:
  - study materialization after publish
  - asset processing
  - retention jobs
  - audit aggregation tasks

### Database
- PostgreSQL is the system of record
- Backups must be scheduled and restore-tested
- Sensitive data policies must be documented before production use

### Object storage
- MinIO locally
- S3-compatible provider for staging/production
- Assets should be accessed through signed or policy-controlled URLs

## Kubernetes Baseline

Recommended deployment units:
- `api`
- `worker`
- `portal`
- `postgres` or managed DB binding
- `redis` if required by worker strategy

Recommended supporting resources:
- ConfigMaps for non-secret config
- Secrets for DB credentials, JWT keys, and encryption material
- Ingress with TLS
- HorizontalPodAutoscaler only after baseline metrics exist

## Secret and Key Handling

Do not hardcode secrets in the repo.

Minimum secret categories:
- Django secret key
- Database credentials
- JWT signing keys
- Encryption root keys or references to external KMS
- Object storage access credentials

## Deployment Pipeline Expectations

### CI
- Lint and test on every push
- Build versioned container images
- Validate migrations

### CD
- Deploy to staging automatically or with approval gate
- Run smoke tests post-deploy
- Promote to production only after staging validation

## Rollback Strategy

Every release candidate must include:
- Previous image tag reference
- Migration compatibility notes
- Rollback procedure if app deploy succeeds but runtime behavior fails

Rollback success criteria:
- API restored to previous working version
- Database state remains consistent
- Researchers can still access active studies

## Observability Requirements

Minimum operational signals:
- API latency and error rate
- Job queue failures and retries
- Database connectivity health
- Result submission success rate
- Asset upload failure rate
- Audit event generation health

## First Deployable Gate

A deployable staging candidate exists when all of the following are true:
- Builder can publish a study to staging
- Portal shows the study automatically
- Interpreter can launch and submit results in staging
- Baseline privacy protections are enabled
- Rollback has been tested once

## Open Deployment Decisions

These do not block initial work but should be settled before broad pilot use:
- Managed PostgreSQL vs self-hosted PostgreSQL in Kubernetes
- Managed object storage vs self-hosted MinIO beyond local development
- Celery vs lighter background job framework
- Ingress controller choice and certificate automation strategy

---

## Day 4 — Platform Integration Feature Flags

The Builder and Interpreter ship with a feature-flag system controlled by
JavaScript globals injected at page load.  This allows the same source to run
against JATOS, local-fallback, or the Django platform backend without
code changes.

### `window.COGFLOW_PLATFORM_URL`

| Value | Effect |
|-------|--------|
| Empty string (default) | JATOS / local-download path unchanged |
| `"http://localhost:8000"` | Enables Platform Publish (Builder) and DjangoRuntimeBackend (Interpreter) |

**Builder** (`frontend/builder/index.html`):
- When set, the **Platform Publish** button appears in the navbar.
- Clicking it calls `POST /api/v1/configs/publish` with the current config JSON,
  study slug, and version label.
- Results are displayed in the Builder's validation status bar.

**Interpreter** (`frontend/interpreter/index.html`):
- When set, `DjangoRuntimeBackend` (`src/djangoRuntimeBackend.js`) is used
  instead of JATOS for result submission.
- On experiment completion the backend calls:
  1. `POST /api/v1/runs/start` → receives `run_session_id`
  2. `POST /api/v1/results/submit` → stores the full trial payload

### Additional globals (optional)

| Global | Purpose |
|--------|---------|
| `window.COGFLOW_STUDY_SLUG` | Default study slug for publish and run-start |
| `window.COGFLOW_STUDY_NAME` | Human-readable study name for publish |
| `window.COGFLOW_CONFIG_VERSION` | Config version label (e.g. `"v1.0"`) |
| `window.COGFLOW_PARTICIPANT_ID` | Participant code passed to run-start |

### Local development quick-start

1. Start the Django backend: `cd backend && python manage.py runserver`
2. Edit `frontend/builder/index.html`:
   ```js
   window.COGFLOW_PLATFORM_URL = 'http://localhost:8000';
   window.COGFLOW_STUDY_SLUG   = 'my-study';
   ```
3. Open `frontend/builder/index.html` in a browser — the
   **Platform Publish** button should appear in the navbar.
4. Edit `frontend/interpreter/index.html` similarly and open it to
   verify the `DjangoRuntimeBackend` path runs end-to-end.

## Day 5 — Vertical Slice Demo Script

Run a full publish -> start-run -> submit-result -> dashboard-metrics flow with one command:

```bash
cd /home/kamisalibayeva/GitHub/cogflow-platform
./scripts/day5_vertical_slice_demo.sh
```

Optional overrides:

```bash
BASE_URL=http://localhost:8000 SLUG=my-day5-demo PARTICIPANT_ID=P-007 ./scripts/day5_vertical_slice_demo.sh
```

Expected pass signal:
- Script prints `[PASS] Day 5 vertical slice demo succeeded`
- `/api/v1/studies` entry for the selected slug has `run_count > 0`
- `/api/v1/studies` entry has non-null `last_result_at`

## Day 6 — User-Based TOTP MFA (Decrypt Protection)

Sensitive decrypt/read access now requires:
1. Authenticated user session (`POST /api/v1/auth/login`)
2. TOTP setup (`POST /api/v1/auth/mfa/setup`)
3. TOTP verification (`POST /api/v1/auth/mfa/verify`)
4. Decrypt request within `MFA_REAUTH_SECONDS` window

Notes:
- MFA uses standard TOTP (`otpauth://`) provisioning, so any TOTP-compatible authenticator app can be used (for example Duo, Google Authenticator, Authy, 1Password, Microsoft Authenticator).

Environment controls:
- `MFA_TOTP_ISSUER` (default: `CogFlow Platform`)
- `MFA_REAUTH_SECONDS` (default: `900`)

Security behavior:
- `POST /api/v1/results/decrypt` returns `401` when unauthenticated
- returns `403` when session has no fresh MFA verification
- logs both denied and successful decrypt attempts to `AuditEvent`
