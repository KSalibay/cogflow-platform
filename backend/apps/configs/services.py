from apps.configs.models import ConfigVersion
from apps.studies.models import Study


def upsert_config_version(
    study: Study,
    version_label: str,
    builder_version: str,
    config_json: dict,
) -> ConfigVersion:
    config_version, _ = ConfigVersion.objects.update_or_create(
        study=study,
        version_label=version_label,
        defaults={"builder_version": builder_version, "config_json": config_json},
    )
    return config_version
