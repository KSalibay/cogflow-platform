# CogFlow Platform

CogFlow Platform is the new self-hosted platform for the CogFlow workflow. It is intended to replace the current JATOS-centric deployment model with a deployable system that can run on infrastructure you control while preserving a fallback path to JATOS during migration.

The platform will eventually bundle:
- Researcher-facing study management
- Builder publishing without manual token copy/paste
- Interpreter runtime integration
- Result ingestion and storage
- Asset storage and delivery
- Audit, retention, and privacy controls

## Current Status

This repository is the new implementation home for the platform migration. The immediate goal is to build a vertical slice that proves the end-to-end workflow:

1. Publish a study from Builder
2. Create or update the study record automatically
3. Show the study on a researcher dashboard
4. Launch Interpreter against the Django-backed runtime
5. Persist results and reflect run state in the platform

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system overview, core domain model, security principles, and migration structure
- [docs/API.md](docs/API.md): initial API surface and contract direction for publish, run start, and result submission
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): local, staging, and Kubernetes deployment model
- [docs/ROADMAP.md](docs/ROADMAP.md): 4-6 week delivery plan toward a deployable pilot option

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

## Implementation Priorities

### Priority 1
- Stand up Django, PostgreSQL, and object storage locally
- Freeze the first API contracts
- Deliver the first vertical slice

### Priority 2
- Introduce privacy-safe result handling
- Add dashboard workflow and study lifecycle management
- Deploy to staging on Kubernetes

### Priority 3
- Harden operations, observability, and rollback procedures
- Expand researcher portal and compliance workflows

## Migration Constraints

- Keep the JATOS fallback path available during transition
- Avoid redesigning Builder and Interpreter payload formats prematurely
- Defer final encryption schema details until the Django models and access patterns are concrete

## Next Step

The next implementation step is to scaffold the platform runtime and deliver the Week 1 vertical slice described in [docs/ROADMAP.md](docs/ROADMAP.md).
