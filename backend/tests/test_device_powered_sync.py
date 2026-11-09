import base64
import hashlib
import os
import secrets
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient

def auth_client(client: TestClient):
    res = client.post("/api/auth/demo")
    assert res.status_code == 200
    token = res.json().get("token")
    return {"token": token, "cookies": res.cookies}

def test_device_registration_and_listing(client: TestClient):
    auth = auth_client(client)
    device_id = secrets.token_hex(16)

    # Register a new mobile device using Bearer token authorization
    reg_resp = client.post(
        "/api/sync/device/register",
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "device_id": device_id,
            "device_name": "Pixel 9 Pro",
            "device_type": "mobile",
            "push_token": "fcm_token_sample",
        },
    )
    assert reg_resp.status_code == 200
    data = reg_resp.json()
    assert data["id"] == device_id
    assert data["device_name"] == "Pixel 9 Pro"

    # List devices
    list_resp = client.get("/api/sync/devices", headers={"Authorization": f"Bearer {auth['token']}"})
    assert list_resp.status_code == 200
    devices = list_resp.json()
    assert any(d["id"] == device_id for d in devices)

    # Revoke device
    del_resp = client.delete(f"/api/sync/devices/{device_id}", headers={"Authorization": f"Bearer {auth['token']}"})
    assert del_resp.status_code == 204

    # Revocation also invalidates this device's bound Bearer session.
    list_resp2 = client.get("/api/sync/devices", headers={"Authorization": f"Bearer {auth['token']}"})
    assert list_resp2.status_code == 401


def test_device_powered_e2e_encryption_and_transfer(client: TestClient):
    """
    Test the device-powered architecture:
    1. Device generates random 256-bit DEK & 96-bit nonce.
    2. Device hashes plaintext (SHA-256).
    3. Device encrypts plaintext with AES-256-GCM (AAD = b'secureshare:file:v2').
    4. Device requests upload intent.
    5. Device sends raw ciphertext to upload_url.
    6. Device confirms upload.
    7. Device requests download intent, fetches ciphertext, and decrypts locally.
    """
    auth = auth_client(client)
    headers = {"Authorization": f"Bearer {auth['token']}"}

    plain_content = b"Top secret confidential report - processed 100% on device!"
    checksum = hashlib.sha256(plain_content).hexdigest()

    # Step 1: Device generates key & nonce
    dek = secrets.token_bytes(32)
    nonce = secrets.token_bytes(12)

    # Step 2 & 3: Device encrypts locally
    aesgcm = AESGCM(dek)
    ciphertext = aesgcm.encrypt(nonce, plain_content, b"secureshare:file:v2")
    ciphertext_hash = hashlib.sha256(ciphertext).hexdigest()

    # Step 4: Request upload authorization
    intent_resp = client.post(
        "/api/storage/upload-intent",
        headers=headers,
        json={
            "name": "secret_report.pdf",
            "size": len(plain_content),
            "ciphertext_size": len(ciphertext),
            "content_type": "application/pdf",
            "sha256_checksum": checksum,
            "ciphertext_sha256": ciphertext_hash,
            "nonce_b64": base64.b64encode(nonce).decode(),
            "wrapped_key_b64": "",
            "encryption_version": "v2",
        },
    )
    assert intent_resp.status_code == 201
    intent = intent_resp.json()
    file_id = intent["file_id"]
    upload_url = intent["upload_url"]

    # Step 5: Transfer ciphertext directly to upload URL
    put_resp = client.put(upload_url, content=ciphertext, headers={"Content-Type": "application/octet-stream", **headers})
    assert put_resp.status_code in (200, 201)

    # Step 6: Confirm upload
    conf_resp = client.post(
        f"/api/files/{file_id}/confirm-upload",
        headers=headers,
        json={"ciphertext_sha256": ciphertext_hash},
    )
    assert conf_resp.status_code == 200
    file_record = conf_resp.json()
    assert file_record["id"] == file_id
    assert file_record["encryption_version"] == "v2"

    # Step 7: Request download intent
    down_intent = client.get(f"/api/files/{file_id}/download-intent", headers=headers)
    assert down_intent.status_code == 200
    down_data = down_intent.json()
    assert down_data["download_url"]

    # Download raw ciphertext
    raw_down = client.get(down_data["download_url"], headers=headers)
    assert raw_down.status_code == 200
    received_ciphertext = raw_down.content
    assert received_ciphertext == ciphertext

    # Step 8: Decrypt locally on device and verify checksum
    received_nonce = base64.b64decode(down_data["nonce_b64"])
    decrypted_plain = aesgcm.decrypt(received_nonce, received_ciphertext, b"secureshare:file:v2")
    assert decrypted_plain == plain_content
    assert hashlib.sha256(decrypted_plain).hexdigest() == checksum


def test_tamper_detection_on_device(client: TestClient):
    """
    Test that bit tampering with ciphertext triggers AES-GCM authentication failure on device.
    """
    plain_content = b"Tamper test document data"
    dek = secrets.token_bytes(32)
    nonce = secrets.token_bytes(12)
    aesgcm = AESGCM(dek)
    ciphertext = aesgcm.encrypt(nonce, plain_content, b"secureshare:file:v2")

    # Corrupt a single byte in ciphertext
    tampered_bytes = bytearray(ciphertext)
    tampered_bytes[10] ^= 0xFF
    tampered_ciphertext = bytes(tampered_bytes)

    # Device decryption MUST fail with InvalidTag
    with pytest.raises(Exception):
        aesgcm.decrypt(nonce, tampered_ciphertext, b"secureshare:file:v2")


def test_trash_and_restore_workflow(client: TestClient):
    auth = auth_client(client)
    headers = {"Authorization": f"Bearer {auth['token']}"}

    # Upload via upload-intent
    plain = b"File to be trashed"
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(secrets.token_bytes(32)).encrypt(nonce, plain, b"secureshare:file:v2")
    ciphertext_hash = hashlib.sha256(ciphertext).hexdigest()
    intent = client.post(
        "/api/storage/upload-intent",
        headers=headers,
        json={
            "name": "trash_me.txt",
            "size": len(plain),
            "ciphertext_size": len(plain) + 16,
            "sha256_checksum": hashlib.sha256(plain).hexdigest(),
            "ciphertext_sha256": ciphertext_hash,
            "nonce_b64": base64.b64encode(nonce).decode(),
            "encryption_version": "v2",
        },
    ).json()
    fid = intent["file_id"]
    assert client.put(intent["upload_url"], content=ciphertext, headers=headers).status_code == 200
    assert client.post(f"/api/files/{fid}/confirm-upload", headers=headers, json={}).status_code == 200

    # Verify in active files
    files = client.get("/api/files", headers=headers).json()
    assert any(f["id"] == fid for f in files)

    # Move to trash
    trash_resp = client.post(f"/api/files/{fid}/trash", headers=headers)
    assert trash_resp.status_code == 200

    # Verify not in active files
    files2 = client.get("/api/files", headers=headers).json()
    assert not any(f["id"] == fid for f in files2)

    # Verify in trash list
    trash_list = client.get("/api/files/trash", headers=headers).json()
    assert any(f["id"] == fid for f in trash_list)

    # Restore from trash
    rest_resp = client.post(f"/api/files/{fid}/restore", headers=headers)
    assert rest_resp.status_code == 200

    # Verify back in active files
    files3 = client.get("/api/files", headers=headers).json()
    assert any(f["id"] == fid for f in files3)


def test_sync_cursor_and_batch(client: TestClient):
    auth = auth_client(client)
    headers = {"Authorization": f"Bearer {auth['token']}"}

    # Check sync status
    status_resp = client.get("/api/sync/status", headers=headers)
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert "active_files_count" in status_data
    assert "server_time" in status_data

    # Check sync cursor
    cursor_resp = client.get("/api/sync/cursor", headers=headers)
    assert cursor_resp.status_code == 200
    cursor_data = cursor_resp.json()
    assert "cursor" in cursor_data
    assert isinstance(cursor_data["files"], list)

    # Test batch sync
    batch_resp = client.post(
        "/api/sync/batch",
        headers=headers,
        json={
            "renames": [],
            "deletions": [],
        },
    )
    assert batch_resp.status_code == 200
    assert "renamed" in batch_resp.json()
    assert "deleted" in batch_resp.json()
