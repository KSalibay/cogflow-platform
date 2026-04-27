from django.db import migrations, models

# The server DB may already contain these columns if they were added outside of
# the migration framework. Using ADD COLUMN IF NOT EXISTS makes this migration
# idempotent and safe to apply in both cases.
_TABLE = "studies_studyresearcheraccess"
_COLUMNS = [
    ("can_download_aggregate", "boolean NOT NULL DEFAULT TRUE"),
    ("can_manage_sharing",     "boolean NOT NULL DEFAULT FALSE"),
    ("can_run_analysis",       "boolean NOT NULL DEFAULT TRUE"),
    ("can_view_full_payload",  "boolean NOT NULL DEFAULT FALSE"),
    ("can_view_pseudonyms",    "boolean NOT NULL DEFAULT FALSE"),
    ("can_view_run_rows",      "boolean NOT NULL DEFAULT FALSE"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0003_add_can_remove_users_column"),
    ]

    operations = [
        # One RunSQL per column so partial failures are easy to diagnose.
        migrations.RunSQL(
            sql=f'ALTER TABLE "{_TABLE}" ADD COLUMN IF NOT EXISTS {col} {dtype};',
            reverse_sql=f'ALTER TABLE "{_TABLE}" DROP COLUMN IF EXISTS {col};',
        )
        for col, dtype in _COLUMNS
    ] + [
        # Keep Django's internal state in sync with the model definition.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_download_aggregate",
                    field=models.BooleanField(default=True),
                ),
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_manage_sharing",
                    field=models.BooleanField(default=False),
                ),
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_run_analysis",
                    field=models.BooleanField(default=True),
                ),
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_view_full_payload",
                    field=models.BooleanField(default=False),
                ),
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_view_pseudonyms",
                    field=models.BooleanField(default=False),
                ),
                migrations.AddField(
                    model_name="studyresearcheraccess",
                    name="can_view_run_rows",
                    field=models.BooleanField(default=False),
                ),
            ],
            database_operations=[],  # already done above
        ),
    ]
