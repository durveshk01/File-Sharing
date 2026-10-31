import base64
import os
import secrets
import tempfile
import pytest

os.environ["KEK_BASE64"] = base64.b64encode(secrets.token_bytes(32)).decode()

from app.encryption import decrypt_file, encrypt_file


def test_round_trip_and_unique_nonces():
    original = b"confidential payload" * 100
    cipher, nonce, wrapped = encrypt_file(original)
    assert decrypt_file(cipher, nonce, wrapped) == original
    _, other_nonce, _ = encrypt_file(original)
    assert nonce != other_nonce


def test_authentication_tag_rejects_tampering_and_wrong_key():
    cipher, nonce, wrapped = encrypt_file(b"private")
    altered = bytearray(cipher); altered[0] ^= 1
    with pytest.raises(Exception):
        decrypt_file(bytes(altered), nonce, wrapped)
    with pytest.raises(Exception):
        decrypt_file(cipher, nonce, b"\x00" * len(wrapped))
