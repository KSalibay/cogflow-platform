from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0005_analysis_report_jobs"),
    ]

    operations = [
        migrations.AddField(
            model_name="study",
            name="launch_properties_json",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
