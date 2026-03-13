# ---------------------------------------------------------------------------
# Runtime modes — used by Study.runtime_mode, serializers, and feature flags
# ---------------------------------------------------------------------------
RUNTIME_MODE_DJANGO = "django"
RUNTIME_MODE_JATOS = "jatos"
RUNTIME_MODE_HYBRID = "hybrid"
RUNTIME_MODE_HOME_GEAR_LSL = "home_gear_lsl"

RUNTIME_MODE_CHOICES = [
    (RUNTIME_MODE_DJANGO, "Django Platform"),
    (RUNTIME_MODE_JATOS, "JATOS"),
    (RUNTIME_MODE_HYBRID, "Hybrid"),
    (RUNTIME_MODE_HOME_GEAR_LSL, "Home Gear LSL"),
]

# ---------------------------------------------------------------------------
# Run session statuses
# ---------------------------------------------------------------------------
RUN_STATUS_STARTED = "started"
RUN_STATUS_COMPLETED = "completed"
RUN_STATUS_FAILED = "failed"
RUN_STATUS_ABANDONED = "abandoned"

RUN_STATUS_CHOICES = [
    (RUN_STATUS_STARTED, "Started"),
    (RUN_STATUS_COMPLETED, "Completed"),
    (RUN_STATUS_FAILED, "Failed"),
    (RUN_STATUS_ABANDONED, "Abandoned"),
]

# Statuses that close a run (no further writes allowed)
RUN_TERMINAL_STATUSES = {RUN_STATUS_COMPLETED, RUN_STATUS_FAILED, RUN_STATUS_ABANDONED}

# ---------------------------------------------------------------------------
# Encryption identifiers written alongside stored ciphertext
# ---------------------------------------------------------------------------
ENCRYPTION_ALG_FERNET = "fernet-256"
ENCRYPTION_KEY_VERSION_1 = "v1"
