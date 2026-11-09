import concurrent.futures
from datetime import datetime, timedelta, timezone
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.encryption import decrypt_file
from app.maintenance import chunk_key, run_maintenance
from app.models import FileRecord, ResumableUpload, StorageCleanup, UploadChunk, User
from app.storage import storage


def demo(client):
    account = client.post("/api/auth/demo").json()
    client.cookies.clear()
    return account, {"Authorization": f"Bearer {account['token']}"}


def upload(client, headers, content=b"Private document"):
    response = client.post("/api/files", headers=headers, files={"file": ("private.txt", content, "text/plain")})
    assert response.status_code == 201, response.text
    return response.json()


def test_copy_has_independent_ciphertext_and_survives_source_deletion(client):
    _, headers = demo(client)
    original = upload(client, headers)
    response = client.post(f"/api/files/{original['id']}/copy", headers=headers)
    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["source_file_id"] == original["id"]
    assert copy["nonce_b64"] == original["nonce_b64"]
    assert copy["encryption_version"] == original["encryption_version"]
    assert client.get("/api/storage/usage", headers=headers).json()["bytes"] == original["size"] * 2
    assert client.delete(f"/api/files/{original['id']}", headers=headers).status_code == 204
    downloaded = client.get(f"/api/files/{copy['id']}/download", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.content == b"Private document"


def test_sync_pages_include_rename_trash_restore_and_permanent_tombstones(client):
    _, headers = demo(client)
    original = upload(client, headers)
    first = client.get("/api/sync/cursor", headers=headers).json()
    assert [f["id"] for f in first["files"]] == [original["id"]]
    assert client.patch(f"/api/files/{original['id']}", headers=headers,
                        json={"name": "renamed.txt", "version": original["version"]}).status_code == 200
    assert client.post(f"/api/files/{original['id']}/trash", headers=headers).status_code == 200
    assert client.post(f"/api/files/{original['id']}/restore", headers=headers).status_code == 200
    assert client.delete(f"/api/files/{original['id']}", headers=headers).status_code == 204
    cursor, files, sequences = first["cursor"], [], []
    while True:
        page = client.get("/api/sync/cursor", headers=headers, params={"since": cursor, "limit": 2}).json()
        files.extend(page["files"])
        sequences.extend(c["sequence"] for c in page["changes"])
        cursor = page["cursor"]
        if not page["has_more"]:
            break
    assert [f["version"] for f in files] == [2, 3, 4, 5]
    assert [f["is_deleted"] for f in files] == [False, True, False, True]
    assert files[-1]["permanently_deleted"] is True
    assert len(set(sequences)) == 4 and sequences == sorted(sequences)
    assert client.get("/api/sync/cursor", headers=headers, params={"since": cursor}).json()["files"] == []
    _, stranger = demo(client)
    assert client.get("/api/sync/cursor", headers=stranger, params={"since": cursor}).status_code == 409
    assert client.get("/api/sync/cursor", headers=headers, params={"since": "invalid"}).status_code == 422


def test_concurrent_renames_allow_only_one_matching_version(client):
    _, headers = demo(client)
    file = upload(client, headers)
    def rename(name):
        return client.patch(f"/api/files/{file['id']}", headers=headers, json={"name": name, "version": 1}).status_code
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(rename, ["first.txt", "second.txt"]))
    assert sorted(results) == [200, 409]
    assert client.patch(f"/api/files/{file['id']}", headers=headers, json={"name": "future.txt", "version": 999}).status_code == 409
    assert client.get(f"/api/files/{file['id']}", headers=headers).json()["version"] == 2


def test_invalid_sync_batch_does_not_mutate_files(client):
    _, headers = demo(client)
    file = upload(client, headers)
    response = client.post("/api/sync/batch", headers=headers,
        json={"renames": [{"file_id": file["id"], "version": 1, "name": None}]})
    assert response.status_code == 422
    assert client.get(f"/api/files/{file['id']}", headers=headers).json()["version"] == 1


def test_resumable_chunks_are_bounded_encrypted_immutable_and_owner_scoped(client, db, monkeypatch):
    _, owner = demo(client)
    monkeypatch.setattr(settings, "max_chunk_bytes", 4)
    response = client.post("/api/files/resumable/init", headers=owner,
        json={"name": "private.txt", "size": 8, "total_chunks": 2, "content_type": "text/plain"})
    assert response.status_code == 201
    upload_id = response.json()["upload_id"]
    url = f"/api/files/resumable/{upload_id}/chunk/0"
    assert client.put(url, headers=owner, content=b"12345").status_code == 413
    assert client.put(url, headers=owner, content=b"priv").status_code == 200
    key = chunk_key(upload_id, 0)
    ciphertext = storage.get(key)
    assert ciphertext != b"priv" and len(ciphertext) == 20
    chunk = db.get(UploadChunk, (upload_id, 0))
    assert decrypt_file(ciphertext, chunk.nonce, chunk.wrapped_key) == b"priv"
    assert client.put(url, headers=owner, content=b"priv").status_code == 200
    assert client.put(url, headers=owner, content=b"evil").status_code == 409
    assert client.get(f"/api/files/resumable/{upload_id}/status", headers=owner).json()["received_bytes"] == 4
    _, stranger = demo(client)
    assert client.delete(f"/api/files/resumable/{upload_id}", headers=stranger).status_code == 404
    assert storage.get(key) == ciphertext
    assert client.put(f"/api/files/resumable/{upload_id}/chunk/1", headers=owner, content=b"ate!").status_code == 200
    complete = client.post(f"/api/files/resumable/{upload_id}/complete", headers=owner)
    assert complete.status_code == 201, complete.text
    assert client.post(f"/api/files/resumable/{upload_id}/complete", headers=owner).json()["id"] == complete.json()["id"]
    assert client.get("/api/storage/usage", headers=owner).json()["bytes"] == 8
    assert client.get(f"/api/files/{complete.json()['id']}/download", headers=owner).content == b"private!"


def test_expiry_releases_resumable_reservations_and_recovers_crashed_leases(client, db):
    account, headers = demo(client)
    init = client.post("/api/files/resumable/init", headers=headers,
        json={"name": "pending.txt", "size": 8, "total_chunks": 2}).json()
    record = db.get(ResumableUpload, init["upload_id"])
    record.state = "receiving"
    record.transfer_token = "abandoned"
    record.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.put(f"/api/files/resumable/{record.id}/chunk/0", headers=headers, content=b"1234").status_code == 200
    db.refresh(record)
    record.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert client.get(f"/api/files/resumable/{record.id}/status", headers=headers).status_code == 410
    run_maintenance(db, storage, now=datetime.now(timezone.utc) + timedelta(minutes=10))
    assert db.get(ResumableUpload, record.id) is None
    db.refresh(db.get(User, account["id"]))
    assert db.get(User, account["id"]).storage_reserved_bytes == 0


def test_deleted_file_audit_survives_and_failed_object_cleanup_is_retried(client, db, monkeypatch):
    _, headers = demo(client)
    file = upload(client, headers)
    object_key = db.get(FileRecord, file["id"]).object_key
    original_delete = storage.delete
    def unavailable(key):
        raise OSError("Storage temporarily unavailable")
    monkeypatch.setattr(storage, "delete", unavailable)
    assert client.delete(f"/api/files/{file['id']}", headers=headers).status_code == 204
    assert db.get(StorageCleanup, object_key) is not None
    assert storage.exists(object_key)
    history = client.get(f"/api/files/{file['id']}/access-logs", headers=headers)
    assert history.status_code == 200
    assert {row["action"] for row in history.json()} >= {"file.uploaded", "file.deleted"}
    monkeypatch.setattr(storage, "delete", original_delete)
    run_maintenance(db, storage, now=datetime.now(timezone.utc) + timedelta(minutes=10))
    assert not storage.exists(object_key)
    assert db.get(StorageCleanup, object_key) is None


def test_expired_demo_accounts_remove_metadata_and_objects(client, db):
    account, headers = demo(client)
    file = upload(client, headers)
    object_key = db.get(FileRecord, file["id"]).object_key
    user = db.get(User, account["id"])
    user.demo_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    run_maintenance(db, storage)
    assert db.scalar(select(User).where(User.id == account["id"])) is None
    assert not storage.exists(object_key)
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_concurrent_maintenance_releases_a_reservation_only_once(client, db, monkeypatch):
    from app import maintenance

    account, headers = demo(client)
    ready = upload(client, headers)
    upload_id = client.post("/api/files/resumable/init", headers=headers,
        json={"name": "abandoned.txt", "size": 8, "total_chunks": 2}).json()["upload_id"]
    pending = db.get(ResumableUpload, upload_id)
    pending.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    gate = threading.Barrier(2)
    claim = maintenance.claim_owner

    def simultaneous_claim(session, user_id):
        gate.wait(timeout=10)
        return claim(session, user_id)

    monkeypatch.setattr(maintenance, "claim_owner", simultaneous_claim)
    engine = db.get_bind()
    now = datetime.now(timezone.utc)

    def tick(_):
        with Session(engine) as session:
            return run_maintenance(session, storage, now=now)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(tick, range(2)))
    assert sum(result["expired_uploads"] for result in results) == 1
    db.expire_all()
    assert db.get(User, account["id"]).storage_reserved_bytes == ready["size"]
    assert db.get(ResumableUpload, upload_id) is None


def test_health_reports_storage_failures(client, monkeypatch):
    assert client.get("/health").status_code == 200
    def unavailable():
        raise OSError("Storage unavailable")
    monkeypatch.setattr(storage, "check_health", unavailable)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["storage"] == "unavailable"
