# CogFlow Platform

CogFlow Platform is the new self-hosted platform for the CogFlow workflow. It is intended to replace the current JATOS-centric deployment model with a deployable system that can run on infrastructure you control while preserving a fallback path to JATOS during migration.

The platform bundles:
- Researcher-facing study management
- Builder publishing without manual token copy/paste
- Interpreter runtime integration
- Result ingestion and storage
- Asset storage and delivery
- Audit, retention, and privacy controls

## Current Status

This repository is in beta-hardening mode toward CogFlow 0.9.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system overview, core domain model, security principles, and migration structure
- [docs/API.md](docs/API.md): API docs hub and publication scopes
- [docs/API_PUBLIC.md](docs/API_PUBLIC.md): public API surface for website publication
- [docs/API_RESEARCHER.md](docs/API_RESEARCHER.md): researcher-facing authenticated API
- [docs/API_ADMIN_INTERNAL.md](docs/API_ADMIN_INTERNAL.md): internal-only admin API docs
- [docs/API_SCHEMAS.md](docs/API_SCHEMAS.md): Builder/Interpreter schema API contracts and task scope mapping
- [docs/CONTRIBUTOR_GUIDE.md](docs/CONTRIBUTOR_GUIDE.md): contribution workflow, formatting expectations, and task onboarding process
- [docs/ADMIN_SECURITY_POLICY.md](docs/ADMIN_SECURITY_POLICY.md): admin access policy and security requirements
- [docs/ADMIN_SECURITY_MATRIX.md](docs/ADMIN_SECURITY_MATRIX.md): endpoint/action control matrix (role, MFA, step-up, audit)
- [docs/site-public/00_COGFLOW_OVERVIEW.md](docs/site-public/00_COGFLOW_OVERVIEW.md): public-public website overview copy
- [docs/site-public/01_ADVANTAGES_AND_SEO_POINTS.md](docs/site-public/01_ADVANTAGES_AND_SEO_POINTS.md): SEO and sales-focused value messaging
- [docs/site-public/02_CUSTOMIZATION_AND_SERVICES.md](docs/site-public/02_CUSTOMIZATION_AND_SERVICES.md): customization and services copy
- [docs/site-public/03_TUTORIALS_PAGE_COPY.md](docs/site-public/03_TUTORIALS_PAGE_COPY.md): tutorials page content scaffolding
- [docs/openapi.json](docs/openapi.json): generated OpenAPI schema artifact used for publication
- [docs/DOCS_MAINTENANCE.md](docs/DOCS_MAINTENANCE.md): update policy, release cadence, and docs publication scope rules
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): local, staging, and Kubernetes deployment model
- [docs/ROADMAP.md](docs/ROADMAP.md): 4-6 week delivery plan toward a deployable pilot option

## Licensing

- [LICENSE](LICENSE): BSD-3-Clause
- [COPYRIGHT.md](COPYRIGHT.md): project ownership and attribution
- [NOTICE](NOTICE): distribution notice and third-party boundary notes

## OpenAPI Generation

The API schema published in `docs/openapi.json` is generated from Django's
schema output:

```bash
./scripts/generate_openapi.sh
```

Use this script whenever API contracts change.

## Maintenance Mode

The backend includes a global maintenance gate that can temporarily block portal
access and return `503` responses while maintenance is in progress.

## Intended Repository Layout

```text
cogflow-platform/
├── backend/
├── frontend/
│   ├── builder/
│   ├── interpreter/
│   └── portal/
├── infra/
├── docs/
└── README.md
```
