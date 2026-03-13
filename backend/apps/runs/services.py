from apps.configs.models import ConfigVersion
from apps.runs.models import RunSession
from apps.studies.models import Study
from project.constants import RUN_STATUS_STARTED


def create_run_session(study: Study, config_version: ConfigVersion, participant_key: str) -> RunSession:
    return RunSession.objects.create(
        study=study,
        config_version=config_version,
        participant_key=participant_key,
        status=RUN_STATUS_STARTED,
    )
