# CogFlow Release Cadence (Post-Alpha)

Purpose: transition from ad-hoc alpha patching to predictable, test-gated releases while keeping urgent hotfix capability.

## 1. Release Trains

### 1.1 Standard cadence
- Weekly release train: Tuesday and Friday windows.
- Tuesday: lower-risk fixes and minor improvements.
- Friday: larger changes only if fully tested and rollback-ready.

### 1.2 Hotfix cadence
- Security and data-integrity hotfixes: any day, emergency process.
- Hotfix must include:
  - explicit scope note
  - rollback step
  - post-incident review entry

## 2. Environment Flow

Required path:
1. Local development validation
2. Staging integration tests
3. Staging UAT checklist sign-off
4. Production deployment window

No direct production-only testing.

## 3. Change Classes and Timing

### 3.1 Patch release (x.y.z)
- Bug fixes, docs corrections, non-breaking behavior changes.
- Typical window: Tuesday.

### 3.2 Minor release (x.y.0)
- New features, endpoint additions, UX additions without breaking contracts.
- Typical window: Friday evening after extended staging soak.

### 3.3 Breaking or migration-heavy work
- Planned maintenance windows only.
- Requires user announcement 48h+ in advance.

## 4. Test Gates

Minimum pass criteria before production:
- Unit/integration suite green.
- API schema regenerated and committed when endpoints changed.
- Smoke tests green for publish/run/submit workflow.
- Security checks completed for auth/csrf/mfa-sensitive paths.

## 5. Proposed Weekly Rhythm

Monday:
- triage and release scope lock
- backlog re-prioritization

Tuesday:
- patch train release
- monitor and incident triage

Wednesday:
- feature integration and docs/tutorial prep

Thursday:
- full staging regression and release notes draft

Friday evening:
- minor release window
- rollback-ready deployment

Weekend:
- monitoring and deferred validation for high-risk changes

## 6. Rollback Policy

Every release must include:
- known-good previous version reference
- rollback commands/scripts
- migration compatibility note

Rollback decision SLA:
- 15 minutes from confirmed severe regression.

## 7. Documentation and Communication

For each release:
- changelog entry
- operator note (risks and rollback)
- user-facing summary for notable impact

If maintenance is required:
- initial notice 48h prior
- reminder 2h prior
- completion message after reopen

## 8. Metrics to Track

Weekly review metrics:
- deployment success rate
- rollback count
- mean time to detect regressions
- mean time to recover
- auth/session related incident count
- result submission success rate

## 9. First 6 Weeks Transition Plan

Weeks 1 to 2:
- start Tuesday patch train only
- keep Friday for optional low-risk changes

Weeks 3 to 4:
- enforce Tuesday + Friday train
- formalize staging sign-off checklist

Weeks 5 to 6:
- fully enforce test gates and release notes template
- publish internal release calendar one month ahead
