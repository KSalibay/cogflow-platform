# Admin Security Policy

This document defines security controls for CogFlow admin access and privileged operations.

## Scope

Applies to:
- Admin endpoints under `/api/v1/admin/*`
- Privileged study actions with high impact (for example owner reassignment, destructive deletes, credential resets)
- Admin UI paths in the portal

## Security Principles

- Enforce authorization server-side on every request.
- Treat UI visibility as convenience, not protection.
- Require stronger checks for higher-risk actions.
- Log all sensitive actions in immutable audit trails.

## Required Controls

### Identity and Role

- Admin endpoints require authenticated session.
- Admin endpoints require admin role authorization.
- Role checks must be performed in backend handlers, not only in frontend code.

### MFA

- MFA enrollment is mandatory for admin-role accounts.
- Step-up MFA is required for destructive or identity-changing actions.
- Step-up MFA freshness should be time bounded (for example 10 to 15 minutes).

### Session and CSRF

- Enforce CSRF protections for state-changing operations.
- Use secure session cookies in non-local environments.
- Re-authenticate or step-up before sensitive state changes when session age is high.

### Audit and Forensics

- Log actor, action, target resource, timestamp, and request metadata.
- Keep perpetual audit event logging.
- Ensure denied privileged attempts are also logged.

### Operational Controls

- Restrict admin tooling visibility in portal navigation to admin users only.
- Require explicit confirmation dialogs for destructive actions.
- Use irreversible action warnings with clear impact text.

## Documentation Publication Rule

- Public website docs must not include admin endpoint details.
- Admin endpoint docs remain in internal documentation scope.
- Security controls are acceptable to describe publicly at policy level, without exposing internal operational details.

## Review Cadence

- Review this policy at every beta/RC milestone.
- Re-verify role and MFA requirements whenever auth flows or admin endpoints change.
