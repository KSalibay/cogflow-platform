#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
SLUG="${SLUG:-day5-demo-study}"
PARTICIPANT_ID="${PARTICIPANT_ID:-P-DEMO-001}"
STAMP="$(date +%Y%m%d%H%M%S)"
VERSION_LABEL="v-demo-${STAMP}"

if ! command -v curl >/dev/null 2>&1; then
  echo "[ERROR] curl is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[ERROR] jq is required" >&2
  exit 1
fi

echo "[1/4] Publish config to ${BASE_URL}"
PUBLISH_JSON="$(curl -sS -X POST "${BASE_URL}/api/v1/configs/publish" \
  -H 'Content-Type: application/json' \
  -d "{\"study_slug\":\"${SLUG}\",\"study_name\":\"Day 5 Vertical Demo\",\"config_version_label\":\"${VERSION_LABEL}\",\"builder_version\":\"day5-demo-script\",\"runtime_mode\":\"django\",\"config\":{\"task_type\":\"rdm\",\"experiment_type\":\"trial-based\",\"n_trials\":4}}")"
echo "${PUBLISH_JSON}" | jq .

echo "[2/4] Start run session"
START_JSON="$(curl -sS -X POST "${BASE_URL}/api/v1/runs/start" \
  -H 'Content-Type: application/json' \
  -d "{\"study_slug\":\"${SLUG}\",\"participant_external_id\":\"${PARTICIPANT_ID}\"}")"
echo "${START_JSON}" | jq .
RUN_SESSION_ID="$(echo "${START_JSON}" | jq -r '.run_session_id')"
if [[ -z "${RUN_SESSION_ID}" || "${RUN_SESSION_ID}" == "null" ]]; then
  echo "[ERROR] Could not parse run_session_id" >&2
  exit 1
fi

echo "[3/4] Submit results"
SUBMIT_JSON="$(curl -sS -X POST "${BASE_URL}/api/v1/results/submit" \
  -H 'Content-Type: application/json' \
  -d "{\"run_session_id\":\"${RUN_SESSION_ID}\",\"status\":\"completed\",\"trial_count\":2,\"result_payload\":{\"format\":\"cogflow-jatos-result-v1\",\"trial_count\":2,\"trials\":[{\"trial_index\":0,\"rt\":480,\"correct\":true},{\"trial_index\":1,\"rt\":520,\"correct\":false}]},\"trials\":[{\"trial_index\":0,\"rt\":480,\"correct\":true},{\"trial_index\":1,\"rt\":520,\"correct\":false}]}")"
echo "${SUBMIT_JSON}" | jq .

echo "[4/4] Verify dashboard metrics"
STUDIES_JSON="$(curl -sS "${BASE_URL}/api/v1/studies")"
ROW_JSON="$(echo "${STUDIES_JSON}" | jq -c --arg slug "${SLUG}" '.studies[] | select(.study_slug==$slug)')"
if [[ -z "${ROW_JSON}" ]]; then
  echo "[ERROR] Study not found in /api/v1/studies for slug=${SLUG}" >&2
  exit 1
fi

echo "${ROW_JSON}" | jq .
RUN_COUNT="$(echo "${ROW_JSON}" | jq -r '.run_count')"
LAST_RESULT_AT="$(echo "${ROW_JSON}" | jq -r '.last_result_at')"

if [[ "${RUN_COUNT}" == "0" || "${RUN_COUNT}" == "null" ]]; then
  echo "[ERROR] Expected run_count > 0; got ${RUN_COUNT}" >&2
  exit 1
fi
if [[ -z "${LAST_RESULT_AT}" || "${LAST_RESULT_AT}" == "null" ]]; then
  echo "[ERROR] Expected last_result_at to be set" >&2
  exit 1
fi

echo ""
echo "[PASS] Day 5 vertical slice demo succeeded"
echo "  study_slug      : ${SLUG}"
echo "  run_session_id  : ${RUN_SESSION_ID}"
echo "  run_count       : ${RUN_COUNT}"
echo "  last_result_at  : ${LAST_RESULT_AT}"
