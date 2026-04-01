# CogFlow Platform Roadmap

## Delivery Window

Target a deployable option in 4 to 6 weeks.

- Week 4: aggressive pilot-ready deployment target
- Week 6: hardened deployment target recommended for broader pilot usage

## Week 1 - Vertical Slice Bootstrap

Goal: prove the core workflow.

Exit criteria:
- New repo scaffolded
- Django API, PostgreSQL, and object storage available locally
- Minimal models and endpoints exist
- Builder publish, Portal visibility, and Interpreter submit flow works locally

## Week 2 - Contract Lock and Reliability

Goal: remove ambiguity from the integration points.

Exit criteria:
- `v1` contracts frozen for publish, start run, submit results, and study list
- Idempotency keys and retry-safe behavior implemented
- Base RBAC roles introduced

## Week 3 - Privacy and Security Hardening

Goal: move from prototype-safe to pilot-safe.

Exit criteria:
- Salted hash strategy implemented for participant linkage
- Sensitive result payload encryption implemented
- Protected reads and decrypt actions audited
- Retention workflow skeleton present

## Week 4 - Staging Deployment and Pilot Gate

Goal: ship the first deployable candidate.

Exit criteria:
- Kubernetes staging deployment live
- End-to-end publish/run/submit flow works in staging
- Rollback tested once
- Release candidate available for pilot evaluation

## Week 5 - Operations and Failure Handling

Goal: make the system resilient enough for non-trivial pilot use.

Exit criteria:
- Monitoring dashboards and alerting enabled
- Queue retry and failure handling improved
- Backup and restore drill completed
- Rate limiting and abuse protection added

## Week 6 - Hardened Release Candidate

Goal: prepare for broader controlled rollout.

Exit criteria:
- Security checklist completed
- Load testing completed
- Pilot documentation written
- Feature-flag runtime strategy documented
- Hardened release candidate approved

## Scope Split

### Minimum deployable scope by Week 4
- Publish from Builder to platform
- Auto-visible study dashboard entry
- Interpreter run with Django runtime
- Result persistence
- Baseline hashing, encryption, and audit trail
- JATOS fallback remains available behind feature flag

### Recommended hardened scope by Week 6
- Observability and alerting
- Restore drill validation
- Retention automation improvements
- Pilot onboarding docs
- Higher confidence release process

## Deferred Features (Backlog)

### Platform Security Hardening Backlog (Post-Alpha)

Context: current alpha usage is limited to a trusted internal cohort, so these are intentionally
scheduled for a later hardening phase before broader external rollout.

Priority backlog items:

1. Runtime HTML and script-injection hardening
- Add stricter sanitization for config-derived HTML fields rendered by Builder/Interpreter.
- Enforce CSP review/update for portal, builder iframe, and interpreter runtime contexts.

2. API payload and complexity guardrails
- Add explicit request body size limits for publish/import/upload endpoints.
- Add defensive validation for excessively deep or complex JSON payloads.

3. Upload and media-serving hardening
- Keep strict upload allowlists (extension, MIME family, size) and extend test coverage.
- Ensure media responses use hardened headers (for example `X-Content-Type-Options: nosniff`).

4. Redirect and external URL safety
- Add allowlist validation for participant completion/abort redirect URLs.
- Prevent open-redirect behavior for externally controlled URLs.

5. Authorization and tenancy boundaries
- Expand authorization tests around study ownership/sharing boundaries for publish/upload/read paths.
- Add periodic audit checks to confirm cross-study access isolation.

6. Security verification and operations
- Add threat-model review for Builder import/upload and interpreter run startup paths.
- Add recurring security regression checks to release criteria (pre-public rollout gate).

### Builder — Researcher-Scoped Templates and Assets

When the Builder is served through the platform (`/builder/`), it should be tied to the authenticated
researcher session so that:

- Each researcher's saved templates are stored against their user record (not in `localStorage` only)
- Asset uploads (images, audio) are stored in the researcher's scoped asset folder on the platform backend
- The Builder pre-loads the researcher's own studies/configs on open, allowing them to resume work
- The "Platform Publish" flow sets the published study's `owner_user` to the currently logged-in researcher

This requires:
1. `GET /api/v1/auth/me` response consumed by the Builder on load to determine identity
2. New `GET/POST /api/v1/builder/templates` endpoints scoped per user
3. Asset API endpoints scoped to `owner_user` (Phase 3 in the plan)
4. `BuilderAppView` to inject `window.COGFLOW_RESEARCHER_USERNAME` alongside the platform URL

Not blocking initial pilot — researchers can use the portal to assign ownership manually after publish.

## Non-Goals for Initial Release

The following are intentionally deferred unless they become hard blockers:
- Full institutional SSO rollout
- Advanced multi-tenant architecture
- Real-time adaptive runtime over WebSockets
- Deep Qualtrics or REDCap integrations
- Full redesign of Builder and Interpreter payload schemas

## Weekly Review Template

At the end of each week, record:
- What shipped
- What passed
- What slipped
- Top risks entering next week
- Go/No-Go decision for next milestone