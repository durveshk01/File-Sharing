import base64, secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings

def _kek() -> bytes:
    try: key = base64.b64decode(settings.kek_base64, validate=True)
    except Exception as exc: raise RuntimeError("KEK_BASE64 must be valid base64") from exc
    if len(key) != 32: raise RuntimeError("KEK_BASE64 must decode to 32 bytes")
    return key

def encrypt_file(plain: bytes) -> tuple[bytes, bytes, bytes, bytes]:
    data_key, nonce, wrap_nonce = secrets.token_bytes(32), secrets.token_bytes(12), secrets.token_bytes(12)
    ciphertext = AESGCM(data_key).encrypt(nonce, plain, b"secureshare:file:v1")
    wrapped = AESGCM(_kek()).encrypt(wrap_nonce, data_key, b"secureshare:key:v1")
    return ciphertext, nonce, wrap_nonce + wrapped

def decrypt_file(ciphertext: bytes, nonce: bytes, wrapped: bytes) -> bytes:
    key = AESGCM(_kek()).decrypt(wrapped[:12], wrapped[12:], b"secureshare:key:v1")
    return AESGCM(key).decrypt(nonce, ciphertext, b"secureshare:file:v1")
