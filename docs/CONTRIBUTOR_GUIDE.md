# CogFlow Contributor Guide

This guide defines how to contribute code safely to the platform repo, including formatting expectations and the process for pulling new task work into `main`.

## Scope

This repository contains:

- Django backend (`backend/`)
- Embedded Builder frontend (`frontend/builder/`)
- Embedded Interpreter frontend (`frontend/interpreter/`)
- Platform docs and deployment artifacts (`docs/`, `scripts/`, `infra/`)

## Formatting and Code Style

## Python (backend)

- Follow existing Django/DRF style in this repo:
  - 4-space indentation
  - clear serializer and view validation paths
  - explicit error messages for contract failures
- Keep API-affecting changes paired with docs updates in the same PR.

Recommended verification before PR:

```bash
cd backend
python manage.py check
python manage.py test --keepdb
```

## JavaScript (Builder/Interpreter)

- Follow existing style in `frontend/builder/src` and `frontend/interpreter/src`:
  - semicolon-terminated statements
  - descriptive inline comments only where behavior is non-obvious
  - preserve existing global-script architecture (non-bundled, script-tag runtime)
- Prefer small, task-focused commits over large mixed refactors.

## Docs

- Any endpoint, payload, schema, or workflow change must update docs in the same PR.
- Regenerate OpenAPI when API contract changes:

```bash
./scripts/generate_openapi.sh
```

## Source-of-Truth Ownership

- Backend HTTP contracts: `docs/openapi.json` + `backend/project/urls.py` + `backend/project/api_serializers.py`
- Builder schema API: `frontend/builder/src/schemas/JSPsychSchemas.js`
- Interpreter schema/compile API: `frontend/interpreter/src/timelineCompiler.js`
- Platform task scope mapping: `backend/project/api_views_common.py` (`TASK_SCOPE_DEFINITIONS`, `SCHEMA_COMPONENT_TYPES`)

## Pulling New Tasks Into Main

This repo embeds Builder/Interpreter code under `frontend/`. Treat task onboarding as a coordinated change across frontend schema, interpreter runtime, and platform mapping.

## Step 1: Implement Task Behavior in Builder and Interpreter

- Add/update Builder authoring schema and UI behavior.
- Add/update Interpreter compile path and runtime plugin behavior.
- Validate Builder export and Interpreter execution together.

## Step 2: Sync Into Platform Frontend Copies

- Sync relevant source changes into:
  - `frontend/builder/`
  - `frontend/interpreter/`
- Preserve platform-specific integration behavior and wrappers.
- Do not replace platform-specific entry wrappers blindly when syncing from standalone repos.

## Step 3: Register Task Scope in Backend

Update task/component mappings so Credits and platform validation stay in sync:

- `backend/project/api_views_common.py`
  - `TASK_SCOPE_DEFINITIONS`
  - `SCHEMA_COMPONENT_TYPES` (if new component types were introduced)

If schema-related API responses changed, also review:

- `backend/project/api_views_runs.py`
- `backend/project/api_views_studies.py`
- `backend/project/api_serializers.py`

## Step 4: Update Documentation

Minimum docs set for schema/task changes:

- `docs/API_SCHEMAS.md`
- `docs/API_PUBLIC.md` and/or `docs/API_RESEARCHER.md` (if endpoint behavior changed)
- `docs/API.md` (hub links or scope updates)
- app-level notes where relevant (`frontend/builder/README.md`, `frontend/interpreter/README.md`)

## Step 5: Validate Before Merge

- Backend checks/tests pass.
- Builder and Interpreter run locally for changed flows.
- OpenAPI regenerated when needed.
- Docs and code in one PR.

## Branch, PR, and Merge Process

1. Branch from `main`.
2. Keep PR scope tight (one feature/fix track).
3. Include contract notes in PR description:
   - endpoints touched
   - schema fields/timeline types touched
   - migration and rollout notes
4. Request review from both platform backend and Builder/Interpreter maintainers for task-level changes.
5. Merge only after docs parity and runtime validation.

## Commit Message Guidance

Use clear, behavior-first subjects.

Examples:

- `Add soc-dashboard subtask timing validation in compiler`
- `Update TASK_SCOPE_DEFINITIONS for continuous-image task`
- `Regenerate OpenAPI and document runs/start schema fields`

For cross-repo sync work, include source SHAs in commit bodies when available.
