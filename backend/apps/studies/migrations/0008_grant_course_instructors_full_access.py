from django.db import migrations


def grant_course_instructors_full_access(apps, schema_editor):
    Study = apps.get_model("studies", "Study")
    StudyResearcherAccess = apps.get_model("studies", "StudyResearcherAccess")

    for study in Study.objects.filter(course_section__isnull=False).select_related("course_section"):
        instructor_id = study.course_section.instructor_user_id
        StudyResearcherAccess.objects.update_or_create(
            study_id=study.id,
            user_id=instructor_id,
            defaults={
                "granted_by_id": study.owner_user_id or instructor_id,
                "can_remove_users": True,
                "can_run_analysis": True,
                "can_download_aggregate": True,
                "can_view_run_rows": True,
                "can_view_pseudonyms": True,
                "can_view_full_payload": True,
                "can_manage_sharing": True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("studies", "0007_coursesection_coursemembership_study_course_section_and_more"),
    ]

    operations = [
        migrations.RunPython(grant_course_instructors_full_access, migrations.RunPython.noop),
    ]