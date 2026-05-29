# CogFlow Builder/Interpreter Schema API

This document makes the Builder and Interpreter schema contracts easy to find from the platform docs.

## Why This Exists

- `docs/openapi.json` documents HTTP endpoints and request/response fields.
- Builder and Interpreter behavior also depends on config and timeline schemas that are not fully represented as JSON Schema artifacts.
- This page is the human-readable API reference for those runtime schemas.

## Canonical Sources

- Builder plugin and modal schema definitions:
  - `frontend/builder/src/schemas/JSPsychSchemas.js`
- Builder shared schema utilities:
  - `frontend/builder/src/schemas/UnifiedSchema.js`
- Interpreter compile contract and task routing:
  - `frontend/interpreter/src/timelineCompiler.js`
- Backend schema/task scope mapping (used by Credits and validation paths):
  - `backend/project/api_views_common.py`
- HTTP contract source of truth:
  - `docs/openapi.json`

## Builder Schema API

The Builder exports a config JSON object consumed by the platform and Interpreter.

Core top-level shape:

```json
{
  "ui_settings": { "theme": "dark" },
  "experiment_type": "trial-based",
  "task_type": "rdm",
  "data_collection": {
    "reaction-time": true,
    "accuracy": true,
    "correctness": false,
    "eye-tracking": false
  },
  "timeline": []
}
```

Core schema points:

- `task_type` selects task-scoped component authoring behavior.
- `experiment_type` controls trial-based vs continuous compilation paths.
- `timeline[]` contains single components and structural/generative items (for example `block`, loop groups, randomization groups).
- Parameter-level plugin schemas are defined in `JSPsychSchemas` and shared helpers in `UnifiedSchema`.

### Builder Task Scopes Used in Platform

Platform-valid task scopes (for Credits and task mapping) currently include:

- `rdm`
- `flanker`
- `sart`
- `stroop`
- `simon`
- `pvt`
- `task-switching`
- `gabor`
- `nback`
- `mot`
- `soc-dashboard`
- `custom`

These are sourced from `TASK_SCOPE_DEFINITIONS` in `backend/project/api_views_common.py`.

## Interpreter Schema API

The Interpreter consumes Builder-exported config JSON and compiles `timeline[]` items by `type`.

Key runtime contract:

- Compiler entrypoint: `frontend/interpreter/src/timelineCompiler.js`
- Task plugin implementations: `frontend/interpreter/src/jspsych-*.js`
- Config loader/runtime bridge: `frontend/interpreter/src/configLoader.js`, `frontend/interpreter/src/djangoRuntimeBackend.js`

Common timeline types compiled at runtime include:

- Generic: `html-keyboard-response`, `html-button-response`, `image-keyboard-response`, `survey-response`, `block`
- Task-specific: `rdm-trial`, `flanker-trial`, `sart-trial`, `stroop-trial`, `emotional-stroop-trial`, `simon-trial`, `pvt-trial`, `task-switching-trial`, `gabor-trial`, `mot-trial`, `nback-block`, `soc-dashboard`
- Continuous/specialized: `continuous-image-presentation`, SOC subtask composition, DRT start/stop boundaries

## HTTP Endpoints That Carry Schema Payloads

These endpoints connect Builder/Interpreter schemas to the backend API:

- `POST /api/v1/configs/publish`
  - Accepts Builder config JSON in the `config` field.
- `POST /api/v1/runs/start`
  - Returns `config` and `configs[]` payloads consumed by Interpreter launch.
- `POST /api/v1/results/submit`
  - Accepts `result_payload` plus optional per-trial `trials[]` data.

Field-level request validation for these endpoints is defined in `backend/project/api_serializers.py`.

## Change Checklist (Schema-Affecting Work)

When Builder/Interpreter schema behavior changes:

1. Update relevant frontend schema/compile files.
2. Update this page if task scopes, timeline types, or schema responsibilities changed.
3. Regenerate API artifact if endpoint payloads changed:
   - `./scripts/generate_openapi.sh`
4. Update `docs/API_PUBLIC.md` and/or `docs/API_RESEARCHER.md` when contract behavior changed.
