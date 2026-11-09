import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings
from app.models import FileRecord, User
from app.security import digest
from app.models import SessionRecord
from app.storage import S3Storage, storage


def demo(client):
    account = client.post("/api/auth/demo").json()
    client.cookies.clear()
    return {"Authorization": f"Bearer {account['token']}"}


def encryption_body(plain=b"Private binary data\x00\xff"):
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(secrets.token_bytes(32)).encrypt(nonce, plain, b"secureshare:file:v2")
    return {
        "name": "private.txt", "size": len(plain), "ciphertext_size": len(ciphertext),
        "content_type": "text/plain", "sha256_checksum": hashlib.sha256(plain).hexdigest(),
        "ciphertext_sha256": hashlib.sha256(ciphertext).hexdigest(),
        "nonce_b64": base64.b64encode(nonce).decode(), "encryption_version": "v2",
    }, ciphertext


def uploaded_file(client, headers):
    body, ciphertext = encryption_body()
    response = client.post("/api/storage/upload-intent", headers=headers, json=body)
    assert response.status_code == 201, response.text
    intent = response.json()
    assert client.put(intent["upload_url"], headers=headers, content=ciphertext).status_code == 200
    assert client.post(f"/api/files/{intent['file_id']}/confirm-upload", headers=headers, json={}).status_code == 200
    return intent, ciphertext


def test_raw_objects_are_owner_authorized_and_immutable(client):
    owner = demo(client)
    body, ciphertext = encryption_body()
    intent = client.post("/api/storage/upload-intent", headers=owner, json=body).json()
    stranger = demo(client)
    assert client.put(intent["upload_url"], headers=stranger, content=ciphertext).status_code == 404
    assert client.put(intent["upload_url"], content=ciphertext).status_code == 401
    assert client.put(intent["upload_url"], headers=owner, content=ciphertext).status_code == 200
    assert client.put(intent["upload_url"], headers=owner, content=ciphertext).status_code == 409
    assert client.post(f"/api/files/{intent['file_id']}/confirm-upload", headers=stranger, json={}).status_code == 404
    assert client.post(f"/api/files/{intent['file_id']}/confirm-upload", headers=owner, json={}).status_code == 200
    assert client.get(intent["upload_url"]).status_code == 401
    assert client.get(intent["upload_url"], headers=stranger).status_code == 404
    assert client.get(intent["upload_url"], headers=owner).content == ciphertext
    assert client.put(intent["upload_url"], headers=owner, content=b"tampered").status_code == 409
    assert client.get(intent["upload_url"], headers=owner).content == ciphertext


def test_pending_files_are_hidden_and_confirmation_checks_storage(client):
    headers = demo(client)
    body, ciphertext = encryption_body()
    intent = client.post("/api/storage/upload-intent", headers=headers, json=body).json()
    file_id = intent["file_id"]
    assert client.get("/api/files", headers=headers).json() == []
    assert client.get(f"/api/files/{file_id}", headers=headers).status_code == 404
    assert client.get(f"/api/files/{file_id}/download-intent", headers=headers).status_code == 404
    assert client.post(f"/api/files/{file_id}/shares", headers=headers, json={}).status_code == 404
    assert client.post(f"/api/files/{file_id}/confirm-upload", headers=headers, json={}).status_code == 400
    assert client.put(intent["upload_url"], headers=headers, content=ciphertext[:-1]).status_code == 422
    assert client.put(intent["upload_url"], headers=headers, content=ciphertext + b"x").status_code == 413
    assert client.put(intent["upload_url"], headers=headers, content=ciphertext).status_code == 200
    assert client.post(f"/api/files/{file_id}/confirm-upload", headers=headers, json={"ciphertext_sha256": "0" * 64}).status_code == 422
    storage.put(intent["object_key"], bytes([ciphertext[0] ^ 1]) + ciphertext[1:])
    assert client.post(f"/api/files/{file_id}/confirm-upload", headers=headers, json={}).status_code == 422
    assert client.get("/api/files", headers=headers).json() == []
    storage.put(intent["object_key"], ciphertext)
    assert client.post(f"/api/files/{file_id}/confirm-upload", headers=headers, json={}).status_code == 200
    assert client.post(f"/api/files/{file_id}/confirm-upload", headers=headers, json={}).status_code == 200
    assert len(client.get("/api/files", headers=headers).json()) == 1


@pytest.mark.parametrize("invalid", [
    {"nonce_b64": "!" * 16}, {"nonce_b64": base64.b64encode(b"short").decode()},
    {"sha256_checksum": "not-a-hash"}, {"ciphertext_sha256": "g" * 64},
    {"encryption_version": "v1"}, {"wrapped_key_b64": "secret-key"},
    {"ciphertext_size": 1000}, {"content_type": "text/plain\r\nInjected: header"},
])
def test_invalid_encryption_metadata_is_rejected(client, invalid):
    headers = demo(client)
    body, _ = encryption_body()
    response = client.post("/api/storage/upload-intent", headers=headers, json={**body, **invalid})
    assert response.status_code in (400, 422)


def test_expired_upload_cannot_write_or_confirm(client, db):
    headers = demo(client)
    body, ciphertext = encryption_body()
    intent = client.post("/api/storage/upload-intent", headers=headers, json=body).json()
    record = db.get(FileRecord, intent["file_id"])
    record.upload_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.put(intent["upload_url"], headers=headers, content=ciphertext).status_code == 410
    assert client.post(f"/api/files/{record.id}/confirm-upload", headers=headers, json={}).status_code == 410


def test_raw_ranges_are_validated_and_unicode_headers_are_safe(client):
    headers = demo(client)
    intent, ciphertext = uploaded_file(client, headers)
    assert client.patch(f"/api/files/{intent['file_id']}", headers=headers, json={"name": "résumé_日本語.txt", "version": 1}).status_code == 200
    response = client.get(intent["upload_url"], headers={**headers, "Range": "bytes=-5"})
    assert response.status_code == 206
    assert response.content == ciphertext[-5:]
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    for value in ("bytes=10000-", "bytes=5-1", "bytes=-0", "bytes=0-2,4-5", "garbage"):
        response = client.get(intent["upload_url"], headers={**headers, "Range": value})
        assert response.status_code == 416
        assert response.headers["content-range"] == f"bytes */{len(ciphertext)}"


def test_shared_storage_grants_enforce_password_quota_and_revocation(client):
    headers = demo(client)
    intent, ciphertext = uploaded_file(client, headers)
    response = client.post(f"/api/files/{intent['file_id']}/shares", headers=headers,
                           json={"password": "a-share-password", "max_downloads": 1}).json()
    token = response["url"].split("/share/")[1]
    assert client.post(f"/api/shares/{token}/download-intent").status_code == 403
    password_grant = client.post(f"/api/shares/{token}/verify", json={"password": "a-share-password"}).json()["grant"]
    proof = {"X-Share-Grant": password_grant}
    first = client.post(f"/api/shares/{token}/download-intent", headers=proof).json()
    second = client.post(f"/api/shares/{token}/download-intent", headers=proof).json()
    assert client.get("/api/shares", headers=headers).json()[0]["downloads"] == 0
    download = client.get(first["download_url"], headers=first["download_headers"])
    assert download.status_code == 200
    assert download.content == ciphertext
    assert client.get(second["download_url"], headers=second["download_headers"]).status_code == 410
    assert client.get(first["download_url"], headers={**first["download_headers"], "Range": "bytes=0-2"}).status_code == 206
    assert client.get("/api/shares", headers=headers).json()[0]["downloads"] == 1
    assert client.delete(f"/api/shares/{response['id']}", headers=headers).status_code == 204
    assert client.get(first["download_url"], headers=first["download_headers"]).status_code in (403, 404)


def test_share_password_changes_invalidate_old_password_and_storage_grants(client):
    headers = demo(client)
    intent, _ = uploaded_file(client, headers)
    share = client.post(f"/api/files/{intent['file_id']}/shares", headers=headers, json={"password": "old-share-password"}).json()
    token = share["url"].split("/share/")[1]
    proof = client.post(f"/api/shares/{token}/verify", json={"password": "old-share-password"}).json()["grant"]
    authorization = client.post(f"/api/shares/{token}/download-intent", headers={"X-Share-Grant": proof}).json()
    assert client.patch(f"/api/shares/{share['id']}", headers=headers, json={"password": "new-share-password"}).status_code == 200
    assert client.post(f"/api/shares/{token}/download-intent", headers={"X-Share-Grant": proof}).status_code == 403
    assert client.get(authorization["download_url"], headers=authorization["download_headers"]).status_code == 403


def test_failed_shared_transfer_does_not_consume_quota(client):
    headers = demo(client)
    intent, _ = uploaded_file(client, headers)
    share = client.post(f"/api/files/{intent['file_id']}/shares", headers=headers, json={"max_downloads": 1}).json()
    token = share["url"].split("/share/")[1]
    authorization = client.post(f"/api/shares/{token}/download-intent").json()
    storage.delete(intent["object_key"])
    assert client.get(authorization["download_url"], headers=authorization["download_headers"]).status_code == 503
    assert client.get("/api/shares", headers=headers).json()[0]["downloads"] == 0


def test_account_quota_counts_pending_uploads_and_cancel_frees_it(client, monkeypatch):
    headers = demo(client)
    body, _ = encryption_body()
    monkeypatch.setattr(settings, "account_quota_bytes", body["size"])
    first = client.post("/api/storage/upload-intent", headers=headers, json=body)
    assert first.status_code == 201
    assert client.post("/api/storage/upload-intent", headers=headers, json=body).status_code == 413
    assert client.delete(f"/api/files/{first.json()['file_id']}", headers=headers).status_code == 204
    assert client.post("/api/storage/upload-intent", headers=headers, json=body).status_code == 201


def test_s3_presigned_upload_cannot_overwrite_finalized_object(client, monkeypatch):
    headers = demo(client)
    objects = {}
    adapter = MagicMock(spec=S3Storage)
    adapter.generate_presigned_upload.side_effect = lambda key, **kwargs: {
        "upload_url": f"https://storage.example/{key}", "method": "PUT", "mode": "direct_s3",
        "headers": {}, "expires_in": 900,
    }
    adapter.exists.side_effect = lambda key: key in objects
    adapter.fingerprint.side_effect = lambda key: (len(objects[key]), hashlib.sha256(objects[key]).hexdigest())
    adapter.copy.side_effect = lambda source, destination: objects.update({destination: objects[source]})
    adapter.delete.side_effect = lambda key: objects.pop(key, None)
    monkeypatch.setattr("app.main.storage", adapter)
    body, ciphertext = encryption_body()
    response = client.post("/api/storage/upload-intent", headers=headers, json=body)
    assert response.status_code == 201
    intent = response.json()
    staging = f"_pending/{intent['object_key']}"
    assert intent["upload_url"].endswith(staging)
    objects[staging] = ciphertext
    assert client.post(f"/api/files/{intent['file_id']}/confirm-upload", headers=headers, json={}).status_code == 200
    objects[staging] = b"overwritten through a still-valid PUT URL"
    assert objects[intent["object_key"]] == ciphertext


def test_storage_grants_cannot_bypass_expired_demo_authentication(client, db):
    headers = demo(client)
    intent, _ = uploaded_file(client, headers)
    authorization = client.get(f"/api/files/{intent['file_id']}/download-intent", headers=headers).json()
    session = db.get(SessionRecord, digest(headers["Authorization"].split()[1]))
    account = db.get(User, session.user_id)
    account.demo_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.get(authorization["download_url"], headers=authorization["download_headers"]).status_code == 403
