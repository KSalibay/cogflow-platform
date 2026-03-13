from apps.audit.models import AuditEvent


def record(
    action: str,
    resource_type: str,
    resource_id: str,
    actor: str = "system",
    metadata: dict | None = None,
) -> AuditEvent:
    return AuditEvent.objects.create(
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        metadata_json=metadata or {},
    )
