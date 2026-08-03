"""Local secret-reference resolver shared with the host-native Manager API."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SecretResolutionError(RuntimeError):
    """A secret reference could not be resolved without exposing its value."""


class EncryptedFileSecretResolver:
    """Read one encrypted entry into process memory for one provider instance.

    The format intentionally mirrors the Manager API's AES-256-GCM file store:
    SHA-256(master material) is the key, while ``iv``, ``tag`` and ``ciphertext``
    are URL-safe base64 fields in a schema-versioned JSON object.
    """

    def __init__(self, path: Path, master_material: str) -> None:
        if not master_material:
            raise SecretResolutionError("secret master material is empty")
        self._path = path
        self._key = hashlib.sha256(master_material.encode("utf-8")).digest()

    def resolve(self, reference_id: str) -> str:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SecretResolutionError("encrypted secret store cannot be read") from exc
        if not isinstance(raw, dict) or raw.get("schemaVersion") != 1 or not isinstance(raw.get("entries"), dict):
            raise SecretResolutionError("encrypted secret store schema is invalid")
        entry = raw["entries"].get(reference_id)
        if not isinstance(entry, dict):
            raise SecretResolutionError("secret reference is unavailable")
        try:
            iv = _decode(entry, "iv")
            tag = _decode(entry, "tag")
            ciphertext = _decode(entry, "ciphertext")
            plaintext = AESGCM(self._key).decrypt(iv, ciphertext + tag, None)
            value = plaintext.decode("utf-8")
        except (KeyError, TypeError, ValueError, UnicodeError) as exc:
            raise SecretResolutionError("secret reference cannot be decrypted") from exc
        if not value:
            raise SecretResolutionError("secret reference is empty")
        return value


def _decode(entry: dict[str, Any], field: str) -> bytes:
    value = entry[field]
    if not isinstance(value, str) or not value:
        raise ValueError(f"secret entry field is invalid: {field}")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
