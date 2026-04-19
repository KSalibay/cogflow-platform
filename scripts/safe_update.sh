#!/usr/bin/env bash
set -euo pipefail

# Safe production update for cogflow-platform with migration-drift handling.
# Usage:
#   ./scripts/safe_update.sh
#   ./scripts/safe_update.sh --skip-pull
# Optional env vars:
#   BRANCH=main
#   BACKUP_FILE=/opt/cogflow-platform/backups/pre_deploy_$(date +%F_%H%M%S).sql

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${BRANCH:-main}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE_DEFAULT="$ROOT_DIR/pre_deploy_backup_${TIMESTAMP}.sql"
BACKUP_FILE="${BACKUP_FILE:-$BACKUP_FILE_DEFAULT}"
DO_PULL=1

for arg in "$@"; do
  case "$arg" in
    --skip-pull)
      DO_PULL=0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: ./scripts/safe_update.sh [--skip-pull]"
      exit 2
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_cmd git
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required."
  exit 1
fi

echo "==> Starting safe update in $ROOT_DIR"

if [[ $DO_PULL -eq 1 ]]; then
  echo "==> Updating git working tree (branch: $BRANCH)"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  echo "==> Skipping git pull as requested"
fi

echo "==> Building API image"
docker compose build --no-cache api

echo "==> Creating DB backup: $BACKUP_FILE"
docker compose exec -T db sh -lc 'pg_dump -U "${POSTGRES_USER:-cogflow}" "${POSTGRES_DB:-cogflow_platform}"' > "$BACKUP_FILE"

echo "==> Migration state before update"
docker compose run --rm api python manage.py showmigrations runs studies users configs

echo "==> Applying known drift-safe fake migrations (idempotent)"
docker compose run --rm api python manage.py migrate runs 0002_runsession_owner_user --fake || true
docker compose run --rm api python manage.py migrate studies 0002_study_owner_user_studyresearcheraccess --fake || true

echo "==> Applying migrations"
docker compose run --rm api python manage.py migrate --noinput

echo "==> Restarting API service"
docker compose up -d api

echo "==> Local health check through API container port"
curl -fsS -I http://127.0.0.1:8000/api/v1/health >/dev/null
echo "    OK: http://127.0.0.1:8000/api/v1/health"

echo "==> If using host nginx, reloading nginx"
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx || true
  fi
fi

echo "==> Public health checks"
if curl -fsS -I https://cogflow.app/api/v1/health >/dev/null; then
  echo "    OK: https://cogflow.app/api/v1/health"
else
  echo "    WARN: Public health check failed; inspect nginx/api logs"
fi

echo "==> Update complete"
echo "Backup saved at: $BACKUP_FILE"
