# CogFlow Platform API

## API Philosophy

The first API version should support one complete workflow before expanding breadth:
- Builder publishes a study configuration
- Portal lists and manages the study
- Interpreter starts a run and submits results

The API should be versioned from the start. Initial examples below use `/api/v1/`.

## Authentication Model

### Researcher-facing access
- Session auth and/or JWT for logged-in researchers
- Role-aware access checks on all study and result resources

### Runtime access
- Platform-generated launch token or signed run token for Interpreter sessions
- Short-lived, purpose-scoped access where practical

## Core Endpoints

### POST /api/v1/configs/publish
Publishes a Builder-generated study configuration and creates or updates related study records.

#### Request shape
```json
{
  "study_slug": "attention-battery-pilot",
  "study_name": "Attention Battery Pilot",
  "config_version_label": "v1",
  "builder_version": "current-builder-version",
  "runtime_mode": "django",
  "config": {},
  "assets": [
    {
      "logical_name": "mask-sprite.png",
      "checksum": "sha256:...",
      "content_type": "image/png"
    }
  ]
}
```

#### Response shape
```json
{
  "study_id": "uuid",
  "config_version_id": "uuid",
  "study_slug": "attention-battery-pilot",
  "dashboard_url": "/portal/studies/attention-battery-pilot",
  "launch_links": {
    "django": "https://platform.example/studies/attention-battery-pilot/launch"
  }
}
```

### GET /api/v1/studies
Returns researcher-visible studies for the authenticated user.

#### Response fields
- study identity and name
- runtime mode
- publication state
- latest config version
- run count
- last activity timestamp

### GET /api/v1/studies/{study_id}
Returns study details, current config version, and launch metadata.

### POST /api/v1/runs/start
Creates a RunSession and returns the runtime payload needed by Interpreter.

#### Request shape
```json
{
  "study_id": "uuid",
  "launch_token": "opaque-or-jwt-token",
  "participant_external_id": "optional-external-id",
  "runtime_mode": "django"
}
```

#### Response shape
```json
{
  "run_session_id": "uuid",
  "config": {},
  "config_version_id": "uuid",
  "participant_key": "salted-hash-or-run-scoped-key",
  "result_submit_url": "/api/v1/results/submit"
}
```

### POST /api/v1/results/submit
Accepts completion data from Interpreter.

#### Request shape
```json
{
  "run_session_id": "uuid",
  "status": "completed",
  "trial_count": 240,
  "result_summary": {
    "task_type": "rdm",
    "experiment_type": "trial-based"
  },
  "result_payload": {}
}
```

#### Response shape
```json
{
  "run_session_id": "uuid",
  "status": "completed",
  "stored": true,
  "received_at": "2026-03-12T12:00:00Z"
}
```

### GET /api/v1/results/{run_session_id}
Returns result metadata and, subject to role and policy, protected payload access.

### POST /api/v1/results/{run_session_id}/decrypt
Requests authorized decrypt access to protected result data.
This must always generate an audit event.

## Supporting Endpoints

### Assets
- POST /api/v1/assets/upload-init
- POST /api/v1/assets/complete
- GET /api/v1/assets/{asset_id}

### Audit and compliance
- GET /api/v1/audit-events
- POST /api/v1/retention/policies
- POST /api/v1/results/{run_session_id}/delete

### Health and operations
- GET /healthz
- GET /readyz
- GET /metrics

## API Design Constraints

### Idempotency
Publish and result submit endpoints should support idempotency keys to avoid duplicate studies or result records during retries.

### Backward compatibility
The initial publish contract should preserve the existing Builder config payload as much as possible. The platform should wrap it, not immediately redesign it.

### Validation
- Study slug uniqueness
- Config schema version compatibility
- Runtime mode enforcement
- Asset checksum verification

### Security
- Request authentication required for researcher APIs
- Signed or scoped runtime tokens for Interpreter launch
- Payload size limits for result ingestion
- Audit event generation for protected reads and decrypts

## First Contract Freeze Goal

By the end of Week 2, the team should freeze the following contracts:
- Publish config request/response
- Start run request/response
- Submit result request/response
- Study list response

Everything else can evolve after the first vertical slice is working.