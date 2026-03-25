from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_explicit_researcher_ownership_columns"),
        ("studies", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE TABLE IF NOT EXISTS studies_studyresearcheraccess ("
                "id bigserial PRIMARY KEY, "
                "created_at timestamp with time zone NOT NULL DEFAULT now(), "
                "study_id bigint NOT NULL REFERENCES studies_study(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "
                "user_id bigint NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "
                "granted_by_id bigint NULL REFERENCES auth_user(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED"
                ");"
            ),
            reverse_sql=(
                "DROP TABLE IF EXISTS studies_studyresearcheraccess;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE UNIQUE INDEX IF NOT EXISTS uniq_study_researcher_access "
                "ON studies_studyresearcheraccess(study_id, user_id);"
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS uniq_study_researcher_access;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS studies_studyresearcheraccess_study_id_idx "
                "ON studies_studyresearcheraccess(study_id);"
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS studies_studyresearcheraccess_study_id_idx;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS studies_studyresearcheraccess_user_id_idx "
                "ON studies_studyresearcheraccess(user_id);"
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS studies_studyresearcheraccess_user_id_idx;"
            ),
        ),
    ]
