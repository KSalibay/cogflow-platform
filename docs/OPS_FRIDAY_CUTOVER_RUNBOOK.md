# CogFlow Friday Night Cutover Runbook

Purpose: controlled migration to long-term host split with public site on cogflow.app and authenticated portal on portal.cogflow.app.

Maintenance window target:
- Start: Friday 20:00 local time
- End target: Saturday 02:00 local time
- Extended validation: through weekend

Owner roles:
- Incident commander: final go/no-go and rollback authority
- Infra operator: reverse proxy, TLS, DNS, firewall
- App operator: Django/env/migrations/services
- Validation lead: smoke tests and researcher workflows
- Communications lead: user broadcast and status updates

## 1. Pre-Window Checklist (T-72h to T-4h)

### 1.1 DNS and TLS readiness
- Add DNS record for portal.cogflow.app (Namecheap) with low TTL (300s) at least 24h ahead.
- Issue TLS certificate for portal.cogflow.app and verify auto-renew mechanism.
- Confirm certificate chain and OCSP status.

### 1.2 Server and SSH hardening baseline
- Disable SSH password authentication.
- Disable root SSH login.
- Ensure key-only auth for all admin users.
- Enforce firewall allowlist: 22, 80, 443 only.
- Install and enable fail2ban (or equivalent).
- Confirm unattended security updates are active.

### 1.3 App security baseline
- Set Django trusted origins for both hostnames.
- Confirm secure session/csrf cookie flags.
- Confirm SECRET_KEY and other secrets are environment-managed.
- Confirm admin/internal routes remain restricted and not publicly linked.

### 1.4 Rollback assets
- Export current reverse proxy config backup.
- Snapshot app env files and compose/k8s manifests.
- Take verified DB backup and backup restore metadata.
- Prepare rollback script and copy commands in one operator file.

### 1.5 Dry-run validation
- Run smoke checks in non-peak environment:
  - login
  - mfa verify
  - study list
  - participant run start
  - result submit
  - protected decrypt

## 2. Communication Plan

### 2.1 User announcements
- T-48h: maintenance notice with expected downtime window.
- T-2h: reminder with exact start and support contact.
- T0: maintenance started.
- Every 60 to 120 minutes: progress update.
- Completion: reopen notice and issue-report instructions.

### 2.2 Suggested channels
- In-app banner (if enabled)
- Email broadcast list
- Team chat/status page

## 3. Cutover Procedure (Friday)

## T-60 min
- Freeze non-essential deploys.
- Confirm all operators present and comms channel active.
- Re-check backup artifacts and rollback commands.

## T-30 min
- Enable maintenance banner.
- Disable creation of new participant sessions where feasible.
- Notify users final warning.

## T0 (start)
- Place portal into maintenance mode (read-only or unavailable).
- Snapshot:
  - reverse proxy configs
  - env files
  - DB backup if not already taken in final hour

## T+15 min
- Apply portal.cogflow.app reverse proxy config.
- Reload proxy and validate syntax prior to reload.
- Validate TLS endpoint on new hostname.

## T+30 min
- Apply app settings for portal origin/cookies/csrf.
- Restart app services.
- Run smoke tests from validation checklist.

## T+60 min
- Validate key end-to-end flows:
  - auth and mfa
  - study launch and run submit
  - researcher dashboard visibility
  - admin access controls

## T+90 min
- If all green: reopen access to limited user subset.
- Monitor for 20 to 30 minutes.

## T+120 min
- Full reopen if metrics and logs are healthy.
- Publish completion message.

## 4. Go/No-Go Criteria

Go if:
- Auth flows are stable.
- No csrf/cookie loop.
- Result submission works end-to-end.
- Error rates are within baseline range.

No-Go or rollback if:
- Repeated auth failures > 10 minutes.
- Result submit failures exceed tolerance.
- Internal/admin access boundaries are broken.

## 5. Rollback Plan

Trigger rollback immediately if no-go criteria hit.

Rollback sequence:
1. Re-enable previous reverse proxy config.
2. Restore previous app env/settings.
3. Restart services to prior known-good version.
4. Validate old hostname auth and result flow.
5. Publish rollback status update.

Target rollback completion:
- 20 to 30 minutes from rollback decision.

## 6. Post-Cutover Weekend Validation

Saturday:
- Security headers and TLS checks.
- Access log and auth failure review.
- Trial submissions with sample studies.

Sunday:
- Retention job and backup verification.
- Internal policy check against ADMIN_SECURITY_POLICY.md and ADMIN_SECURITY_MATRIX.md.
- Final sign-off for weekday reopening (if partial maintenance remained).

## 7. Evidence to Archive

Store in internal ops folder:
- Final proxy configs (before/after)
- Backup IDs and timestamps
- Smoke test checklist results
- Incident timeline and status messages
- Any issues and mitigations for next cutover

## 8. Reference Config Snippets

### 8.1 App environment (portal host split)

```env
DJANGO_ALLOWED_HOSTS=cogflow.app,www.cogflow.app,portal.cogflow.app
DJANGO_CSRF_TRUSTED_ORIGINS=https://cogflow.app,https://www.cogflow.app,https://portal.cogflow.app
DJANGO_SESSION_COOKIE_DOMAIN=.cogflow.app
DJANGO_CSRF_COOKIE_DOMAIN=.cogflow.app
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
DJANGO_USE_X_FORWARDED_PROTO=1
DJANGO_USE_X_FORWARDED_HOST=1
COGFLOW_PLATFORM_URL=https://portal.cogflow.app
```

### 8.2 Website environment

```env
VITE_PUBLIC_SITE_BASE_URL=https://cogflow.app
VITE_PORTAL_BASE_URL=https://portal.cogflow.app
```

### 8.3 Reverse proxy sketch (Nginx)

```nginx
server {
  listen 80;
  server_name cogflow.app www.cogflow.app;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name cogflow.app www.cogflow.app;

  # TLS cert directives here

  root /var/www/cogflow-site/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }
}

server {
  listen 80;
  server_name portal.cogflow.app;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name portal.cogflow.app;

  # TLS cert directives here

  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
  }
}
```

### 8.4 Post-change smoke URLs

- https://cogflow.app/
- https://portal.cogflow.app/portal/
- https://portal.cogflow.app/api/v1/health
