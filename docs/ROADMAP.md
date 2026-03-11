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