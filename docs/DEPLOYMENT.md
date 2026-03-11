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