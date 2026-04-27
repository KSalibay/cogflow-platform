from django.db import migrations, models

# The server DB may already contain these tables from an earlier partial deploy.
# SeparateDatabaseAndState lets Django update its internal migration state without
# re-running the DDL, while the RunSQL blocks use IF NOT EXISTS / DO-NOTHING guards
# so the migration is fully idempotent.

_JOB_TABLE = "studies_studyanalysisreportjob"
_ARTIFACT_TABLE = "studies_studyanalysisreportartifact"
_CONSTRAINT = "uniq_report_job_artifact_format"


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0004_studyaccess_permissions"),
        migrations.swappable_dependency("auth.User"),
    ]

    operations = [
        # ------------------------------------------------------------------ #
        # 1. DDL — idempotent via IF NOT EXISTS                               #
        # ------------------------------------------------------------------ #
        migrations.RunSQL(
            sql=f"""
                CREATE TABLE IF NOT EXISTS "{_JOB_TABLE}" (
                    id               bigserial PRIMARY KEY,
                    status           varchar(20)  NOT NULL DEFAULT 'queued',
                    engine           varchar(20)  NOT NULL DEFAULT 'python',
                    requested_formats jsonb        NOT NULL DEFAULT '[]',
                    include_completed_only boolean NOT NULL DEFAULT TRUE,
                    options          jsonb        NOT NULL DEFAULT '{{}}',
                    permissions_snapshot jsonb    NOT NULL DEFAULT '{{}}',
                    snapshot_json    jsonb        NOT NULL DEFAULT '{{}}',
                    error_message    text         NOT NULL DEFAULT '',
                    worker_log       text         NOT NULL DEFAULT '',
                    started_at       timestamptz,
                    completed_at     timestamptz,
                    created_at       timestamptz  NOT NULL,
                    updated_at       timestamptz  NOT NULL,
                    requested_by_id  integer REFERENCES auth_user(id) ON DELETE SET NULL,
                    study_id         integer NOT NULL REFERENCES studies_study(id) ON DELETE CASCADE
                );
            """,
            reverse_sql=f'DROP TABLE IF EXISTS "{_JOB_TABLE}" CASCADE;',
        ),
        migrations.RunSQL(
            sql=f"""
                CREATE TABLE IF NOT EXISTS "{_ARTIFACT_TABLE}" (
                    id              bigserial PRIMARY KEY,
                    artifact_format varchar(20)  NOT NULL,
                    file_name       varchar(255) NOT NULL,
                    mime_type       varchar(120) NOT NULL,
                    text_content    text         NOT NULL DEFAULT '',
                    binary_content  bytea,
                    metadata_json   jsonb        NOT NULL DEFAULT '{{}}',
                    created_at      timestamptz  NOT NULL,
                    job_id          bigint       NOT NULL REFERENCES "{_JOB_TABLE}"(id) ON DELETE CASCADE
                );
            """,
            reverse_sql=f'DROP TABLE IF EXISTS "{_ARTIFACT_TABLE}" CASCADE;',
        ),
        migrations.RunSQL(
            sql=f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = '{_CONSTRAINT}'
                    ) THEN
                        ALTER TABLE "{_ARTIFACT_TABLE}"
                            ADD CONSTRAINT "{_CONSTRAINT}"
                            UNIQUE (job_id, artifact_format);
                    END IF;
                END
                $$;
            """,
            reverse_sql=f'ALTER TABLE "{_ARTIFACT_TABLE}" DROP CONSTRAINT IF EXISTS "{_CONSTRAINT}";',
        ),
        # ------------------------------------------------------------------ #
        # 2. State-only — keep Django's migration graph consistent            #
        # ------------------------------------------------------------------ #
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="StudyAnalysisReportJob",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("succeeded", "Succeeded"), ("failed", "Failed")], default="queued", max_length=20)),
                        ("engine", models.CharField(default="python", max_length=20)),
                        ("requested_formats", models.JSONField(blank=True, default=list)),
                        ("include_completed_only", models.BooleanField(default=True)),
                        ("options", models.JSONField(blank=True, default=dict)),
                        ("permissions_snapshot", models.JSONField(blank=True, default=dict)),
                        ("snapshot_json", models.JSONField(blank=True, default=dict)),
                        ("error_message", models.TextField(blank=True)),
                        ("worker_log", models.TextField(blank=True)),
                        ("started_at", models.DateTimeField(blank=True, null=True)),
                        ("completed_at", models.DateTimeField(blank=True, null=True)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="requested_analysis_report_jobs", to="auth.user")),
                        ("study", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="analysis_report_jobs", to="studies.study")),
                    ],
                    options={"ordering": ["-created_at"]},
                ),
                migrations.CreateModel(
                    name="StudyAnalysisReportArtifact",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("artifact_format", models.CharField(choices=[("markdown", "Markdown"), ("rmd", "R Markdown"), ("html", "HTML"), ("pdf", "PDF"), ("snapshot", "Snapshot")], max_length=20)),
                        ("file_name", models.CharField(max_length=255)),
                        ("mime_type", models.CharField(max_length=120)),
                        ("text_content", models.TextField(blank=True)),
                        ("binary_content", models.BinaryField(blank=True, null=True)),
                        ("metadata_json", models.JSONField(blank=True, default=dict)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("job", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="artifacts", to="studies.studyanalysisreportjob")),
                    ],
                    options={"ordering": ["created_at"]},
                ),
                migrations.AddConstraint(
                    model_name="studyanalysisreportartifact",
                    constraint=models.UniqueConstraint(fields=("job", "artifact_format"), name="uniq_report_job_artifact_format"),
                ),
            ],
        ),
    ]