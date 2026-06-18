#!/usr/bin/env bash
set -Eeuo pipefail

# Daily API refresh for cogflow-platform docker compose stack.
# - Restarts only the `api` service.
# - Waits for local health endpoint to return 2xx/3xx.
# - Uses a lock file to avoid overlapping runs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCK_FILE="${REPO_ROOT}/logs/.daily_api_refresh.lock"
LOG_DIR="${REPO_ROOT}/logs/maintenance"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8000/api/v1/auth/csrf}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_RETRY_SECONDS="${HEALTH_RETRY_SECONDS:-5}"

mkdir -p "${LOG_DIR}" "$(dirname "${LOCK_FILE}")"

# Ensure cron environments can still find docker.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

LOG_FILE="${LOG_DIR}/daily_api_refresh-$(date -u +%Y%m%d).log"

choose_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  echo ""
  return 1
}

wait_for_health() {
  local deadline now code
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

  while true; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" || true)"
    if [[ "${code}" =~ ^2|3 ]]; then
      return 0
    fi

    now=${SECONDS}
    if (( now >= deadline )); then
      return 1
    fi

    sleep "${HEALTH_RETRY_SECONDS}"
  done
}

{
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] starting daily API refresh"
  echo "repo_root=${REPO_ROOT}"
  echo "health_url=${HEALTH_URL}"

  COMPOSE_CMD="$(choose_compose_cmd)"
  if [[ -z "${COMPOSE_CMD}" ]]; then
    echo "ERROR: docker compose command not found"
    exit 1
  fi

  cd "${REPO_ROOT}"

  # Lock to prevent overlap if cron drifts or manual run overlaps.
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    echo "another refresh run is already in progress; exiting"
    exit 0
  fi

  echo "using compose cmd: ${COMPOSE_CMD}"
  ${COMPOSE_CMD} ps api

  echo "restarting api service"
  ${COMPOSE_CMD} restart api

  echo "waiting for health"
  if wait_for_health; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] success: api healthy after restart"
    exit 0
  fi

  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: api health check failed after restart"
  ${COMPOSE_CMD} ps api || true
  ${COMPOSE_CMD} logs --since 10m api | tail -n 200 || true
  exit 2
} >>"${LOG_FILE}" 2>&1
