import base64
import hashlib
import os

from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured

# Fixed key for local development — consistent across container restarts so
# stored ciphertext remains decryptable in dev.  NOT a secret; never use in
# any environment where DJANGO_DEBUG is False.
_DEV_FERNET_KEY: str = base64.urlsafe_b64encode(b"dev-only-key-DO-NOT-USE-IN-PROD!").decode()


def hash_identifier(raw_value: str) -> str:
    salt = os.getenv("IDENTIFIER_SALT", "dev-only-salt")
    payload = f"{salt}:{raw_value}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def get_fernet() -> Fernet:
    key = os.getenv("RESULT_ENCRYPTION_KEY")
    if not key:
        if os.getenv("DJANGO_DEBUG", "1") != "1":
            raise ImproperlyConfigured(
                "RESULT_ENCRYPTION_KEY must be set when DJANGO_DEBUG is disabled. "
                "Generate one with: "
                "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        key = _DEV_FERNET_KEY
    return Fernet(key.encode("utf-8"))


def encrypt_payload(payload_json: str) -> str:
    return get_fernet().encrypt(payload_json.encode("utf-8")).decode("utf-8")


def decrypt_payload(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted payload string.

    Callers are responsible for recording an AuditEvent after a successful
    decrypt (actor, action='decrypt_payload', resource_type, resource_id).
    """
    return get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
