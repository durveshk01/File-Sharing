import base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings

def _kek() -> bytes:
    try: key = base64.b64decode(settings.kek_base64, validate=True)
    except Exception as exc: raise RuntimeError("KEK_BASE64 must be valid base64") from exc
    if len(key) != 32: raise RuntimeError("KEK_BASE64 must decode to 32 bytes")
    return key

def encrypt_file(plain: bytes) -> tuple[bytes, bytes, bytes]:
    data_key, nonce, wrap_nonce = secrets.token_bytes(32), secrets.token_bytes(12), secrets.token_bytes(12)
    ciphertext = AESGCM(data_key).encrypt(nonce, plain, b"secureshare:file:v1")
    wrapped = AESGCM(_kek()).encrypt(wrap_nonce, data_key, b"secureshare:key:v1")
    return ciphertext, nonce, wrap_nonce + wrapped

def decrypt_file(ciphertext: bytes, nonce: bytes, wrapped: bytes) -> bytes:
    key = AESGCM(_kek()).decrypt(wrapped[:12], wrapped[12:], b"secureshare:key:v1")
    return AESGCM(key).decrypt(nonce, ciphertext, b"secureshare:file:v1")


def protect_totp_secret(secret: str) -> str:
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_kek()).encrypt(nonce, secret.encode("ascii"), b"secureshare:totp:v1")
    return "enc:v1:" + base64.b64encode(nonce + encrypted).decode("ascii")


def reveal_totp_secret(stored: str) -> str:
    # Compatibility for secrets created before the encrypted-secret migration.
    if not stored.startswith("enc:v1:"):
        return stored
    payload = base64.b64decode(stored[7:], validate=True)
    return AESGCM(_kek()).decrypt(payload[:12], payload[12:], b"secureshare:totp:v1").decode("ascii")
