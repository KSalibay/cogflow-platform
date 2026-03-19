# CogFlow Platform API (Day 3 Contract Freeze)

This file defines the **current v1 contract** for the Week 1 vertical slice and matches the implementation in `backend/project/api_views.py`.

## Local Integration Ports

- `cogflow-platform` API: `http://127.0.0.1:8000`
- `cogflow-builder-app` local UI: typically `http://127.0.0.1:5500` (VS Code Live Server)
- `cogflow-interpreter-app` local UI: use `http://127.0.0.1:5501` when running side-by-side (or `:5500` when run alone)

Builder and Interpreter call the API on port `8000` (as shown in `frontend/builder/publish_stub.html` and `frontend/interpreter/runtime_stub.html`).

## DRF Schema Output

- Live schema endpoint: `GET /api/schema`
- Name in Django URLs: `openapi-schema`
- JSON output uses DRF's built-in OpenAPI generator.

Generate a checked-in schema artifact:

```bash
cd /home/kamisalibayeva/GitHub/cogflow-platform

docker compose exec -T api python manage.py generateschema --format openapi-json > docs/openapi.json
```

## OpenAPI 3.0 Schema

```yaml
openapi: 3.0.3
info:
  title: CogFlow Platform API
  version: 1.0.0-day3
  description: |
    Day 3 contract-first API for the Week 1 vertical slice.
    Covers publish, start-run, submit-result, studies list, and health.
servers:
  - url: http://127.0.0.1:8000
    description: Local Docker compose API
  - url: http://localhost:8000
    description: Local Docker compose API (alt hostname)
tags:
  - name: Ops
  - name: Studies
  - name: Builder
  - name: Interpreter
paths:
  /healthz:
    get:
      tags: [Ops]
      summary: Service health check
      responses:
        '200':
          description: Service is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
                    example: true
                required: [ok]

  /api/v1/studies:
    get:
      tags: [Studies]
      summary: List studies visible in portal
      responses:
        '200':
          description: Studies list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StudiesListResponse'

  /api/v1/configs/publish:
    post:
      tags: [Builder]
      summary: Publish a Builder config and upsert study linkage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PublishConfigRequest'
      responses:
        '201':
          description: Config accepted and study linkage upserted
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PublishConfigResponse'
        '400':
          description: Validation error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ValidationError'

  /api/v1/runs/start:
    post:
      tags: [Interpreter]
      summary: Start a run session for a published study
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/StartRunRequest'
      responses:
        '201':
          description: Run session created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/StartRunResponse'
        '400':
          description: Validation error or no published config
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/ValidationError'
                  - $ref: '#/components/schemas/ErrorMessage'
        '404':
          description: Study not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorMessage'

  /api/v1/results/submit:
    post:
      tags: [Interpreter]
      summary: Submit aggregate and optional per-trial result payloads
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SubmitResultRequest'
      responses:
        '201':
          description: Result stored
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SubmitResultResponse'
        '400':
          description: Validation error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ValidationError'
        '404':
          description: Run session not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorMessage'

components:
  schemas:
    RuntimeMode:
      type: string
      enum: [django, jatos, hybrid, home_gear_lsl]

    RunStatus:
      type: string
      enum: [completed, failed]

    ErrorMessage:
      type: object
      properties:
        error:
          type: string
      required: [error]

    ValidationError:
      type: object
      additionalProperties: true
      description: DRF validation error object keyed by field name.

    PublishConfigRequest:
      type: object
      required:
        - study_slug
        - study_name
        - config_version_label
        - config
      properties:
        study_slug:
          type: string
          pattern: '^[a-zA-Z0-9_-]+$'
          example: attention-battery-pilot
        study_name:
          type: string
          maxLength: 255
          example: Attention Battery Pilot
        config_version_label:
          type: string
          maxLength: 50
          example: v1
        builder_version:
          type: string
          maxLength: 50
          example: 2026.03.13
        runtime_mode:
          $ref: '#/components/schemas/RuntimeMode'
        config:
          type: object
          additionalProperties: true

    PublishConfigResponse:
      type: object
      properties:
        study_id:
          type: integer
          example: 12
        config_version_id:
          type: integer
          example: 54
        study_slug:
          type: string
          example: attention-battery-pilot
        dashboard_url:
          type: string
          example: /portal/studies/attention-battery-pilot
      required: [study_id, config_version_id, study_slug, dashboard_url]

    StartRunRequest:
      type: object
      required: [study_slug]
      properties:
        study_slug:
          type: string
          example: attention-battery-pilot
        participant_external_id:
          type: string
          nullable: true
          example: participant-001

    StartRunResponse:
      type: object
      properties:
        run_session_id:
          type: string
          format: uuid
        study_slug:
          type: string
        config_version_id:
          type: integer
        config:
          type: object
          additionalProperties: true
        participant_key:
          type: string
          description: Salted SHA-256 pseudonym key.
      required: [run_session_id, study_slug, config_version_id, config, participant_key]

    TrialPayload:
      type: object
      additionalProperties: true
      description: Arbitrary task-specific trial data.

    SubmitResultRequest:
      type: object
      required:
        - run_session_id
        - status
        - trial_count
        - result_payload
      properties:
        run_session_id:
          type: string
          format: uuid
        status:
          $ref: '#/components/schemas/RunStatus'
        trial_count:
          type: integer
          minimum: 0
          example: 240
        result_summary:
          type: object
          additionalProperties: true
        result_payload:
          type: object
          additionalProperties: true
        trials:
          type: array
          items:
            $ref: '#/components/schemas/TrialPayload'
          default: []

    SubmitResultResponse:
      type: object
      properties:
        run_session_id:
          type: string
          format: uuid
        status:
          type: string
        stored:
          type: boolean
          example: true
        trial_records_stored:
          type: integer
          minimum: 0
          example: 240
      required: [run_session_id, status, stored, trial_records_stored]

    StudyListItem:
      type: object
      properties:
        study_slug:
          type: string
        study_name:
          type: string
        runtime_mode:
          $ref: '#/components/schemas/RuntimeMode'
        latest_config_version:
          type: string
          nullable: true
        run_count:
          type: integer
          minimum: 0
        last_result_at:
          type: string
          format: date-time
          nullable: true
        last_activity_at:
          type: string
          format: date-time
        dashboard_url:
          type: string
      required:
        - study_slug
        - study_name
        - runtime_mode
        - latest_config_version
        - run_count
        - last_result_at
        - last_activity_at
        - dashboard_url

    StudiesListResponse:
      type: object
      properties:
        studies:
          type: array
          items:
            $ref: '#/components/schemas/StudyListItem'
      required: [studies]
```

## Day 3 Contract Notes

- `POST /api/v1/configs/publish` is **upsert-safe** by `study_slug` and `config_version_label`.
- `POST /api/v1/runs/start` uses `study_slug` (not `study_id`) in v1.
- `POST /api/v1/results/submit` supports optional `trials[]` for per-trial persistence.
- The three endpoints above are covered by integration tests in `backend/project/tests/test_day3_api_contract.py`.