import base64
import hashlib
import json

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from veetee_server.secrets import EncryptedFileSecretResolver


def test_resolver_reads_manager_aes_gcm_shape(tmp_path):
    master = "unit-master-material"
    reference = "reference-1"
    value = b"canary-secret-value"
    iv = bytes.fromhex("00112233445566778899aabb")
    encrypted = AESGCM(hashlib.sha256(master.encode()).digest()).encrypt(iv, value, None)
    payload = {
        "schemaVersion": 1,
        "entries": {
            reference: {
                "version": 1,
                "iv": base64.urlsafe_b64encode(iv).rstrip(b"=").decode(),
                "tag": base64.urlsafe_b64encode(encrypted[-16:]).rstrip(b"=").decode(),
                "ciphertext": base64.urlsafe_b64encode(encrypted[:-16]).rstrip(b"=").decode(),
            }
        },
    }
    path = tmp_path / "secrets.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    resolver = EncryptedFileSecretResolver(path, master)
    assert resolver.resolve(reference) == value.decode()
