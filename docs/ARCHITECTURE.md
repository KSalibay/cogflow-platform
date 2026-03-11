# CogFlow Platform Architecture

## Purpose

CogFlow Platform is the new self-hosted home for the CogFlow workflow. It replaces the current JATOS + token-store-centered deployment model with a platform that can run on infrastructure you control while keeping a controlled fallback path to JATOS during migration.

The target outcome is a single deployable system that provides:
- Researcher authentication and authorization
- Study creation and lifecycle management
- Builder publishing without manual token copy/paste
- Interpreter launch and runtime management
- Result ingestion and storage
- Asset storage and delivery
- Auditability, retention, and privacy controls

## High-Level System

The platform is organized into four major layers:

1. Frontend applications
- Builder: publishes compiled study configurations and assets to the platform
- Interpreter: runs studies using a Django-backed runtime or JATOS fallback
- Portal: researcher-facing dashboard for study management, runs, and results

2. Backend services
- Django API: primary application backend
- Background worker: asynchronous jobs for study materialization, asset processing, retention, and audit pipelines
- PostgreSQL: system of record for metadata, studies, runs, results, and audit events
- Object storage: durable asset storage using an S3-compatible backend

3. Platform infrastructure
- Kubernetes deployment for API, worker, portal, and supporting services
- Secret management for database credentials, JWT keys, and encryption material
- Ingress/TLS for secure external access
- Observability stack for logs, metrics, and alerts

4. Migration compatibility
- JATOS runtime remains available as a feature-flagged fallback during migration
- Existing Builder and Interpreter logic is progressively wrapped behind adapter interfaces

## Primary User Flows

### Builder Publish Flow
1. Researcher authenticates to the platform.
2. Builder compiles a study configuration.
3. Builder publishes configuration and referenced assets to the Django API.
4. Backend creates or updates the Study and ConfigVersion records.
5. A background job materializes the study on the Portal dashboard.
6. Researcher can immediately manage launch links and study state.

### Interpreter Run Flow
1. Participant launches a study session via a platform-generated link.
2. Interpreter resolves runtime configuration from the Django backend.
3. Backend creates a RunSession record and returns runtime metadata.
4. Interpreter executes the study locally in the browser.
5. Interpreter submits result payloads and completion status to the platform.
6. Portal reflects run state, counts, and result availability.

### JATOS Fallback Flow
1. Study is flagged for JATOS or hybrid runtime mode.
2. Builder still emits JATOS-compatible deployment metadata when required.
3. Interpreter uses the JATOS runtime adapter instead of the Django runtime adapter.
4. Platform continues to track study metadata and migration state.

## Core Domain Model

### Study
Represents a researcher-managed study. Owns runtime mode, publication state, and launch metadata.

### ConfigVersion
Represents a published Builder output associated with a Study. Supports versioning, compatibility tracking, and provenance.

### RunSession
Represents a single participant run. Stores launch context, runtime mode, timestamps, and status.

### ResultEnvelope
Stores normalized study result metadata and an encrypted payload for sensitive behavioral data.

### Asset
Stores metadata for uploaded study assets. Physical binaries live in object storage.

### AuditEvent
Records sensitive actions such as publish, download, decrypt, delete, and admin operations.

## Security and Privacy Principles

### Data handling
- Do not store raw participant identifiers when avoidable.
- Use salted hashes for participant linkage and search keys.
- Use field-level encryption or encrypted payload blobs for sensitive behavioral data.
- Separate low-sensitivity operational metadata from protected research payloads.

### Access control
- Researcher access is role-scoped and organization-scoped.
- Decrypt access must be explicit, auditable, and deny-by-default.
- Service-to-service access uses managed secrets and short-lived tokens where practical.

### Compliance posture
The MVP target is not formal certification, but it must provide operationally credible controls:
- Audit logging
- Retention and deletion workflows
- Encryption in transit and at rest
- Backup and restore procedures

## Initial Repository Layout

```text
cogflow-platform/
├── backend/
├── frontend/
│   ├── builder/
│   ├── interpreter/
│   └── portal/
├── infra/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── ROADMAP.md
└── README.md
```

## Initial Technical Direction

### Backend
- Django + Django REST Framework
- PostgreSQL
- Celery or Django-Q style background worker
- S3-compatible object storage

### Frontend
- Existing Builder and Interpreter are initially integrated with minimal behavioral change
- Portal can use a framework-based UI once the API contracts are stable

### Infrastructure
- Docker Compose for local development
- Kubernetes for staging and production
- MinIO for local object storage parity

## First Implementation Milestone

The first milestone is a vertical slice, not full feature completeness.

That slice includes:
- Publish config from Builder
- Auto-create study record
- Show study in Portal
- Launch Interpreter against Django runtime
- Submit results and update dashboard

That milestone defines the architecture more reliably than speculative schema work alone.