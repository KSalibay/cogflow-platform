from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("configs", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskCreditAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("component_type", models.CharField(max_length=80, unique=True)),
                ("scope_text", models.TextField(blank=True, default="")),
                ("credit_roles", models.JSONField(blank=True, default=list)),
                ("contributors", models.JSONField(blank=True, default=list)),
                ("notes", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="updated_task_credit_assignments",
                        to="auth.user",
                    ),
                ),
            ],
            options={"ordering": ["component_type"]},
        ),
    ]
