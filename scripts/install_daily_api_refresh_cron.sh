#!/usr/bin/env bash
set -Eeuo pipefail

# Installs or updates a daily cron entry for scripts/daily_api_refresh.sh.
# Default run time: 03:17 UTC daily.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REFRESH_SCRIPT="${REPO_ROOT}/scripts/daily_api_refresh.sh"
CRON_SCHEDULE="${CRON_SCHEDULE:-17 3 * * *}"

if [[ ! -x "${REFRESH_SCRIPT}" ]]; then
  echo "ERROR: refresh script not found or not executable: ${REFRESH_SCRIPT}"
  exit 1
fi

CRON_CMD="${REFRESH_SCRIPT}"
CRON_LINE="${CRON_SCHEDULE} ${CRON_CMD}"

TMP_CRON="$(mktemp)"
trap 'rm -f "${TMP_CRON}"' EXIT

# Preserve existing cron entries, remove old variants of this job, then append one canonical entry.
crontab -l 2>/dev/null | grep -v "${REFRESH_SCRIPT}" > "${TMP_CRON}" || true
echo "${CRON_LINE}" >> "${TMP_CRON}"
crontab "${TMP_CRON}"

echo "Installed cron entry: ${CRON_LINE}"
echo "Current crontab:"
crontab -l
