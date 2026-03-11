import hashlib
import os

from cryptography.fernet import Fernet


def hash_identifier(raw_value: str) -> str:
    salt = os.getenv("IDENTIFIER_SALT", "dev-only-salt")
    payload = f"{salt}:{raw_value}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def get_fernet() -> Fernet:
    key = os.getenv("RESULT_ENCRYPTION_KEY")
    if not key:
        # Deterministic development key; replace in real env.
        key = Fernet.generate_key().decode("utf-8")
    return Fernet(key.encode("utf-8"))


def encrypt_payload(payload_json: str) -> str:
    return get_fernet().encrypt(payload_json.encode("utf-8")).decode("utf-8")
