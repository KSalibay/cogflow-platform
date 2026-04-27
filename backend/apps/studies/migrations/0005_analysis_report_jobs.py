from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studies", "0004_studyaccess_permissions"),
        migrations.swappable_dependency("auth.User"),
    ]

    operations = [
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
    ]