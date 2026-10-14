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
PUBLIC_HEALTHCHECK_URL="${PUBLIC_HEALTHCHECK_URL:-https://portal.cogflow.app/healthz}"
DO_PULL=1
ENV_BACKUP_DIR=""
ENV_PATHS=(".env" "backend/.env")

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

run_migration() {
  docker compose run --rm -T \
  -e COGFLOW_MIGRATION_APP="$1" \
  -e COGFLOW_MIGRATION_NAME="$2" \
  -e COGFLOW_MIGRATION_FAKE="${3:-}" \
  api python manage.py shell -v 0 -c '
import os
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

target = (os.environ["COGFLOW_MIGRATION_APP"], os.environ["COGFLOW_MIGRATION_NAME"])
executor = MigrationExecutor(connection)
if target in executor.loader.applied_migrations:
  print("    %s.%s already recorded; skipping" % target)
else:
  plan = executor.migration_plan([target])
  if any(backwards for _, backwards in plan):
    raise SystemExit("Refusing a migration plan containing rollbacks")
  fake = os.environ.get("COGFLOW_MIGRATION_FAKE") == "--fake"
  if fake and (len(plan) != 1 or (plan[0][0].app_label, plan[0][0].name) != target):
    raise SystemExit("Refusing to fake unapplied dependencies; reconcile them first")
  call_command("migrate", *target, fake=fake, interactive=False)
'
}

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required."
  exit 1
fi

echo "==> Starting safe update in $ROOT_DIR"

if [[ $DO_PULL -eq 1 ]]; then
  ENV_BACKUP_DIR="$(mktemp -d "$ROOT_DIR/.env.safe_update.XXXXXX")"
  echo "==> Preparing local env files for safe pull"
  for rel in "${ENV_PATHS[@]}"; do
    abs="$ROOT_DIR/$rel"
    bkp="$ENV_BACKUP_DIR/${rel//\//__}"

    if [[ -f "$abs" ]]; then
      cp "$abs" "$bkp"
      chmod 600 "$bkp" || true
    fi

    # If env file is tracked and locally modified, clear worktree/index drift before pull.
    if git ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
      git restore --worktree --staged --source=HEAD -- "$rel" >/dev/null 2>&1 || true
      git update-index --skip-worktree "$rel" >/dev/null 2>&1 || true
    fi
  done

  echo "==> Updating git working tree (branch: $BRANCH)"
  git fetch origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"

  if [[ -n "$ENV_BACKUP_DIR" && -d "$ENV_BACKUP_DIR" ]]; then
    restored_any=0
    for rel in "${ENV_PATHS[@]}"; do
      abs="$ROOT_DIR/$rel"
      bkp="$ENV_BACKUP_DIR/${rel//\//__}"
      if [[ -f "$bkp" ]]; then
        mkdir -p "$(dirname "$abs")"
        cp "$bkp" "$abs"
        chmod 600 "$abs" || true
        restored_any=1
      fi
    done

    if [[ $restored_any -eq 1 ]]; then
      echo "==> Restored local env files after pull"
    fi

    rm -rf "$ENV_BACKUP_DIR"
    ENV_BACKUP_DIR=""
  fi
else
  echo "==> Skipping git pull as requested"
fi

echo "==> Building API image"
docker compose build --no-cache api

echo "==> Creating DB backup: $BACKUP_FILE"
docker compose exec -T db sh -lc 'pg_dump -U "${POSTGRES_USER:-cogflow}" "${POSTGRES_DB:-cogflow_platform}"' > "$BACKUP_FILE"

echo "==> Migration state before update"
docker compose run --rm api python manage.py showmigrations runs studies users configs

echo "==> Reconciling runs.0002 (owner column)"
RUNS_OWNER_STATE="$(docker compose run --rm -T api python manage.py shell -v 0 -c '
from django.db import connection
with connection.cursor() as cursor:
    tables = connection.introspection.table_names(cursor)
    columns = connection.introspection.get_table_description(cursor, "runs_runsession") if "runs_runsession" in tables else []
print("exists" if any(column.name == "owner_user_id" for column in columns) else "missing")
')"
case "$RUNS_OWNER_STATE" in
  exists) run_migration runs 0002_runsession_owner_user --fake ;;
  missing) run_migration runs 0002_runsession_owner_user ;;
  *) echo "ERROR: Could not inspect runs owner column"; exit 1 ;;
esac

echo "==> Reconciling studies.0002 (ownership and collaborator access)"
STUDY_OWNER_STATE="$(docker compose run --rm -T api python manage.py shell -v 0 -c '
from django.db import connection
with connection.cursor() as cursor:
    tables = connection.introspection.table_names(cursor)
    columns = connection.introspection.get_table_description(cursor, "studies_study") if "studies_study" in tables else []
    owner_exists = any(column.name == "owner_user_id" for column in columns)
    access_exists = "studies_studyresearcheraccess" in tables
    if access_exists:
        access_columns = {column.name for column in connection.introspection.get_table_description(cursor, "studies_studyresearcheraccess")}
        expected = {"id", "study_id", "user_id", "granted_by_id", "created_at", "can_remove_users"}
        if not expected.issubset(access_columns):
            raise SystemExit("Incomplete collaborator table; refusing to fake studies.0002")
    if owner_exists != access_exists:
        raise SystemExit("Partial studies.0002 schema; reconcile ownership and collaborator access before continuing")
print("exists" if owner_exists else "missing")
')"
case "$STUDY_OWNER_STATE" in
  exists) run_migration studies 0002_study_owner_user_studyresearcheraccess --fake ;;
  missing) run_migration studies 0002_study_owner_user_studyresearcheraccess ;;
  *) echo "ERROR: Could not inspect study ownership schema"; exit 1 ;;
esac

echo "==> Applying studies migrations through 0005"
run_migration studies 0005_analysis_report_jobs

echo "==> Reconciling studies.0006 (launch_properties_json)"
if docker compose run --rm api python manage.py shell -c "from django.db import connection; c=connection.cursor(); c.execute(\"SELECT 1 FROM information_schema.columns WHERE table_name='studies_study' AND column_name='launch_properties_json' LIMIT 1\"); raise SystemExit(0 if c.fetchone() else 1)"; then
  echo "    Detected existing studies_study.launch_properties_json; faking studies.0006"
  run_migration studies 0006_study_launch_properties_json --fake
else
  echo "    Column not present; applying studies.0006 normally"
  run_migration studies 0006_study_launch_properties_json
fi

echo "==> Reconciling runs.0003 (flow variant fields)"
if docker compose run --rm api python manage.py shell -c "from django.db import connection; c=connection.cursor(); cols=('flow_variant_id','flow_variant_label','has_flow_variant'); c.execute(\"SELECT column_name FROM information_schema.columns WHERE table_name='runs_runsession' AND column_name IN ('flow_variant_id','flow_variant_label','has_flow_variant')\"); found={r[0] for r in c.fetchall()}; raise SystemExit(0 if all(col in found for col in cols) else 1)"; then
  echo "    Detected existing runs_runsession flow-variant columns; faking runs.0003"
  run_migration runs 0003_runsession_flow_variant_fields --fake
else
  echo "    Columns not fully present; applying runs.0003 normally"
  run_migration runs 0003_runsession_flow_variant_fields
fi

echo "==> Reconciling studies.0007 (course section tables)"
COURSE_MIGRATION_STATE="$(docker compose run --rm -T api python manage.py shell -v 0 -c '
from django.db import connection
from django.db.migrations.loader import MigrationLoader

target = ("studies", "0007_coursesection_coursemembership_study_course_section_and_more")
loader = MigrationLoader(connection)
if target in loader.applied_migrations:
    print("already_applied")
else:
    state = loader.project_state([target])
    with connection.cursor() as cursor:
        tables = set(connection.introspection.table_names(cursor))
        study_columns = {column.name for column in connection.introspection.get_table_description(cursor, "studies_study")}
        present = ["studies_coursesection" in tables, "studies_coursemembership" in tables, "course_section_id" in study_columns]
        if any(present) and not all(present):
            raise SystemExit("Partial course schema; refusing to fake studies.0007")
        if all(present):
            for name in ("CourseSection", "CourseMembership"):
                model = state.apps.get_model("studies", name)
                columns = {column.name for column in connection.introspection.get_table_description(cursor, model._meta.db_table)}
                if not {field.column for field in model._meta.local_fields}.issubset(columns):
                    raise SystemExit("Incomplete course table; refusing to fake studies.0007")
                constraints = connection.introspection.get_constraints(cursor, model._meta.db_table)
                for constraint in model._meta.constraints:
                    if not constraints.get(constraint.name, {}).get("unique"):
                        raise SystemExit("Missing course uniqueness constraint; refusing to fake studies.0007")
        print("schema_exists" if all(present) else "schema_missing")
')"
case "$COURSE_MIGRATION_STATE" in
  already_applied) echo "    studies.0007 already recorded; skipping" ;;
  schema_exists) run_migration studies 0007_coursesection_coursemembership_study_course_section_and_more --fake ;;
  schema_missing) run_migration studies 0007_coursesection_coursemembership_study_course_section_and_more ;;
  *) echo "ERROR: Could not inspect course migration schema"; exit 1 ;;
esac

echo "==> Reconciling users.0007 (instructor/student roles)"
if docker compose run --rm api python manage.py shell -c "from django.db import connection; c=connection.cursor(); c.execute(\"SELECT 1 FROM django_migrations WHERE app='users' AND name='0007_alter_userprofile_role' LIMIT 1\"); raise SystemExit(0 if c.fetchone() else 1)"; then
  echo "    users.0007 already recorded; skipping"
else
  run_migration users 0007_alter_userprofile_role
fi

echo "==> Applying studies migrations through 0008"
run_migration studies 0008_grant_course_instructors_full_access

echo "==> Reconciling studies.0009 (SONA launch-link table)"
SONA_MIGRATION_STATE="$(docker compose run --rm -T api python manage.py shell -v 0 -c '
from django.db import connection
from django.db.migrations.loader import MigrationLoader

loader = MigrationLoader(connection)
migration = loader.get_migration("studies", "0009_sonalaunchlink")
if ("studies", "0009_sonalaunchlink") in loader.applied_migrations:
    print("already_applied")
elif len(migration.operations) != 1 or migration.operations[0].__class__.__name__ != "CreateModel" or migration.operations[0].name.lower() != "sonalaunchlink":
    raise SystemExit("Refusing to reconcile studies.0009: expected only CreateModel(SonaLaunchLink)")
else:
    table_name = migration.operations[0].options.get("db_table", "studies_sonalaunchlink")
    if table_name != "studies_sonalaunchlink":
      raise SystemExit("Refusing to reconcile studies.0009: unexpected SONA table name")
    with connection.cursor() as cursor:
      exists = table_name in connection.introspection.table_names(cursor)
      if exists:
        model = loader.project_state([("studies", "0009_sonalaunchlink")]).apps.get_model("studies", "SonaLaunchLink")
        columns = {column.name for column in connection.introspection.get_table_description(cursor, table_name)}
        if not {field.column for field in model._meta.local_fields}.issubset(columns):
          raise SystemExit("Incomplete SONA table; refusing to fake studies.0009")
        constraints = connection.introspection.get_constraints(cursor, table_name)
        for name in ("code", "study_id"):
          if not any(value.get("unique") and value.get("columns") == [name] for value in constraints.values()):
            raise SystemExit("Missing SONA uniqueness constraint; refusing to fake studies.0009")
    print("table_exists" if exists else "table_missing")
')" || {
  echo "ERROR: Could not safely inspect studies.0009; no migration was applied."
  exit 1
}

case "$SONA_MIGRATION_STATE" in
  already_applied)
    echo "    studies.0009 already recorded; skipping"
    ;;
  table_exists)
    echo "    Existing SONA launch-link table detected; recording studies.0009 without schema changes"
    run_migration studies 0009_sonalaunchlink --fake
    ;;
  table_missing)
    echo "    SONA launch-link table not present; applying studies.0009 normally"
    run_migration studies 0009_sonalaunchlink
    ;;
  *)
    echo "ERROR: Unexpected studies.0009 inspection result: $SONA_MIGRATION_STATE"
    exit 1
    ;;
esac

echo "==> Reconciling runs.0004 (encrypted SONA credit URL)"
SONA_CREDIT_STATE="$(docker compose run --rm -T api python manage.py shell -v 0 -c '
from django.db import connection, migrations
from django.db.migrations.loader import MigrationLoader

target = ("runs", "0004_runsession_sona_credit_url_encrypted")
loader = MigrationLoader(connection)
if target in loader.applied_migrations:
  print("already_applied")
else:
  migration = loader.get_migration(*target)
  if len(migration.operations) != 1:
    raise SystemExit("Refusing to reconcile runs.0004: unexpected operations")
  operation = migration.operations[0]
  if not isinstance(operation, migrations.AddField) or operation.model_name != "runsession" or operation.name != "sona_credit_url_encrypted":
    raise SystemExit("Refusing to reconcile runs.0004: expected only the SONA credit AddField")
  model = loader.project_state([target]).apps.get_model("runs", "RunSession")
  field = model._meta.get_field(operation.name)
  with connection.cursor() as cursor:
    columns = {column.name: column for column in connection.introspection.get_table_description(cursor, model._meta.db_table)}
  column = columns.get(field.column)
  if column is None:
    print("column_missing")
  elif connection.introspection.get_field_type(column.type_code, column) == "TextField" and column.null_ok == field.null:
    print("column_exists")
  else:
    raise SystemExit("Existing SONA credit column has an incompatible type or nullability; no migration was faked")
')"
case "$SONA_CREDIT_STATE" in
  already_applied) echo "    runs.0004 already recorded; skipping" ;;
  column_exists) run_migration runs 0004_runsession_sona_credit_url_encrypted --fake ;;
  column_missing) run_migration runs 0004_runsession_sona_credit_url_encrypted ;;
  *) echo "ERROR: Could not safely inspect runs.0004"; exit 1 ;;
esac

echo "==> Applying remaining migrations"
docker compose run --rm api python manage.py migrate --noinput

echo "==> Restarting API service"
docker compose up -d api

echo "==> Local health check through API container port"
curl -fsS --retry 5 --retry-connrefused --max-time 10 http://127.0.0.1:8000/healthz >/dev/null
echo "    OK: http://127.0.0.1:8000/healthz"

echo "==> If using host nginx, reloading nginx"
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx || true
  fi
fi

echo "==> Public health checks"
if curl -fsS --max-time 20 "$PUBLIC_HEALTHCHECK_URL" >/dev/null; then
  echo "    OK: $PUBLIC_HEALTHCHECK_URL"
else
  echo "    WARN: Public health check failed; inspect nginx/api logs"
fi

echo "==> Update complete"
echo "Backup saved at: $BACKUP_FILE"
