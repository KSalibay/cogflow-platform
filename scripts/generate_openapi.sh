#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/docs/openapi.json"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
SCHEMA_TITLE="CogFlow Platform API"
SCHEMA_URL="http://127.0.0.1:8000"

echo "[info] Generating OpenAPI schema into $OUT_FILE"

if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$COMPOSE_FILE" ps --status running api >/dev/null 2>&1; then
    if command -v curl >/dev/null 2>&1; then
      curl -fsS \
        -H "Accept: application/vnd.oai.openapi+json" \
        "$SCHEMA_URL/api/schema" > "$OUT_FILE"
      echo "[ok] Schema generated from running Docker API service"
      exit 0
    fi
  fi
fi

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_CMD="$ROOT_DIR/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
else
  echo "[error] python3 is not available and no .venv python was found"
  exit 1
fi

(
  cd "$ROOT_DIR/backend"
  "$PYTHON_CMD" manage.py generateschema \
    --title "$SCHEMA_TITLE" \
    --url "$SCHEMA_URL" \
    --format openapi-json
) > "$OUT_FILE"

echo "[ok] Schema generated from local backend environment"