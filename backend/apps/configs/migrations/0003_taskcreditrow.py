from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("configs", "0002_taskcreditassignment"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskCreditRow",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("task_type", models.CharField(max_length=80)),
                ("component_type", models.CharField(max_length=80)),
                ("credit_role", models.CharField(max_length=80)),
                ("contributor_username", models.CharField(max_length=150)),
                ("notes", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="updated_task_credit_rows",
                        to="auth.user",
                    ),
                ),
            ],
            options={
                "ordering": ["task_type", "component_type", "credit_role", "contributor_username", "id"],
            },
        ),
    ]
