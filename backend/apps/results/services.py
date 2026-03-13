import json

from apps.results.models import ResultEnvelope, TrialResult
from apps.runs.models import RunSession
from project.constants import ENCRYPTION_ALG_FERNET, ENCRYPTION_KEY_VERSION_1
from project.security import decrypt_payload, encrypt_payload


def store_result_envelope(
    run_session: RunSession,
    trial_count: int,
    summary_json: dict,
    result_payload: dict,
) -> ResultEnvelope:
    envelope, _ = ResultEnvelope.objects.update_or_create(
        run_session=run_session,
        defaults={
            "trial_count": trial_count,
            "summary_json": summary_json,
            "encrypted_payload": encrypt_payload(json.dumps(result_payload)),
            "key_version": ENCRYPTION_KEY_VERSION_1,
            "encryption_alg": ENCRYPTION_ALG_FERNET,
        },
    )
    return envelope


def store_trial_results(run_session: RunSession, trials: list[dict]) -> int:
    """Bulk-upsert trial records. Returns number of records written."""
    if not trials:
        return 0

    objects = [
        TrialResult(
            run_session=run_session,
            trial_index=trial.get("trial_index", idx),
            block_label=str(trial.get("block_label", trial.get("block", ""))),
            task_name=str(trial.get("task_name", trial.get("task", ""))),
            stimulus_key=str(trial.get("stimulus_key", trial.get("stimulus", ""))),
            response_key=str(trial.get("response_key", trial.get("response", ""))),
            rt_ms=trial.get("rt_ms", trial.get("rt")),
            correct=trial.get("correct"),
            encrypted_payload=encrypt_payload(json.dumps(trial)),
            key_version=ENCRYPTION_KEY_VERSION_1,
            encryption_alg=ENCRYPTION_ALG_FERNET,
        )
        for idx, trial in enumerate(trials)
    ]
    TrialResult.objects.bulk_create(
        objects,
        update_conflicts=True,
        update_fields=[
            "block_label",
            "task_name",
            "stimulus_key",
            "response_key",
            "rt_ms",
            "correct",
            "encrypted_payload",
            "key_version",
            "encryption_alg",
        ],
        unique_fields=["run_session", "trial_index"],
    )
    return len(objects)


def get_decrypted_envelope(envelope: ResultEnvelope) -> dict:
    """Decrypt a ResultEnvelope's payload. Caller must record an audit event."""
    return json.loads(decrypt_payload(envelope.encrypted_payload))


def get_decrypted_trial(trial: TrialResult) -> dict:
    """Decrypt a single TrialResult's payload. Caller must record an audit event."""
    return json.loads(decrypt_payload(trial.encrypted_payload))
