from apps.studies.models import Study


def get_active_study(slug: str) -> Study | None:
    return Study.objects.filter(slug=slug, is_active=True).first()


def upsert_study(slug: str, name: str, runtime_mode: str) -> Study:
    study, _ = Study.objects.update_or_create(
        slug=slug,
        defaults={"name": name, "runtime_mode": runtime_mode},
    )
    return study
