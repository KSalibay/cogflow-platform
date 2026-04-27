from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0003_add_can_remove_users_column"),
    ]

    operations = [
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
    ]
