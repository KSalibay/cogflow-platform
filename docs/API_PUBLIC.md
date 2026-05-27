# CogFlow Public API

This document lists endpoints safe to publish on public documentation pages.

## Audience

- Integrators embedding or calling Interpreter runtime paths
- Partners evaluating launch/submit behavior
- Public technical reference consumers

## Base URL

- Local: `http://127.0.0.1:8000`
- Staging/production: environment-specific

## Public Endpoints

### Ops
- `GET /healthz`

### Runtime Launch and Results
- `POST /api/v1/runs/start`
- `POST /api/v1/results/submit`

### Read Access (limited)
- `GET /api/v1/studies`

## Notes for Public Publishing

- Keep examples pseudonymized (no real participant identifiers).
- Do not publish internal admin workflow details in this section.
- If endpoint behavior changes, regenerate `docs/openapi.json` and update this page in the same PR.

## Schema Reference

Use `docs/openapi.json` for exact request/response fields and status codes.
