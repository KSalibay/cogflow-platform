# CogFlow Platform API Docs

This page is the API documentation hub.

Canonical machine-readable contract:
- `docs/openapi.json`

Regenerate the schema artifact:

```bash
./scripts/generate_openapi.sh
```

## API Documentation Split

- [Public API](API_PUBLIC.md): participant-facing and integration-safe endpoints for launch and result submission paths.
- [Researcher API](API_RESEARCHER.md): authenticated researcher workflows (study lifecycle, sharing, analysis jobs, assets).
- [Admin API (Internal)](API_ADMIN_INTERNAL.md): privileged platform administration endpoints.

## Internal Security References

- [Admin Security Policy](ADMIN_SECURITY_POLICY.md)
- [Admin Action Security Matrix](ADMIN_SECURITY_MATRIX.md)

## Website Public-Public Copy Pack

- [CogFlow Overview](site-public/00_COGFLOW_OVERVIEW.md)
- [Advantages and SEO Points](site-public/01_ADVANTAGES_AND_SEO_POINTS.md)
- [Customization and Services](site-public/02_CUSTOMIZATION_AND_SERVICES.md)
- [Tutorials Page Copy](site-public/03_TUTORIALS_PAGE_COPY.md)

## Publication Scopes

- Public website docs (`cogflow.app`) should publish only Public API and approved Researcher API sections.
- Admin API docs should remain internal-only documentation.

## Endpoint Source of Truth

Endpoint routing lives in `backend/project/urls.py`.
OpenAPI is generated from the running backend schema endpoint (`/api/schema`) using the script above.

## Update Policy

Follow `docs/DOCS_MAINTENANCE.md` for update triggers, cadence, and release gates.
