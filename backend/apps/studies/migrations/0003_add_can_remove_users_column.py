from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0002_study_owner_user_studyresearcheraccess"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "ALTER TABLE studies_studyresearcheraccess "
                "ADD COLUMN IF NOT EXISTS can_remove_users boolean NOT NULL DEFAULT false;"
            ),
            reverse_sql=(
                "ALTER TABLE studies_studyresearcheraccess "
                "DROP COLUMN IF EXISTS can_remove_users;"
            ),
        ),
    ]
