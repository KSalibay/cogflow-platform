from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("studies", "0008_grant_course_instructors_full_access")]

    operations = [
        migrations.CreateModel(
            name="SonaLaunchLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=32, unique=True)),
                ("launch_token", models.TextField()),
                ("expires_at", models.DateTimeField()),
                ("study", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="sona_launch_link", to="studies.study")),
            ],
        ),
    ]