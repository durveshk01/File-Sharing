import pytest
import hashlib
from app.main import sent_emails

def create_user(client, name, email):
    client.post("/api/auth/register", json={"name": name, "email": email, "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": email, "password": "password123456"})
    return res.cookies.get("secureshare_session")

def test_permissions_workflow(client):
    owner_sess = create_user(client, "Owner User", "owner_perm@example.com")
    collaborator_sess = create_user(client, "Collaborator", "collab@example.com")

    # Upload file
    upload_resp = client.post(
        "/api/files",
        files={"file": ("project_plan.pdf", b"%PDF-1.4 confidential plan", "application/pdf")},
        cookies={"secureshare_session": owner_sess},
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    # Collaborator cannot download file initially
    dl_fail = client.get(f"/api/files/{file_id}/download", cookies={"secureshare_session": collaborator_sess})
    assert dl_fail.status_code == 404

    # Owner grants VIEWER permission to collaborator
    perm_resp = client.post(
        f"/api/files/{file_id}/permissions",
        json={"email": "collab@example.com", "role": "VIEWER"},
        cookies={"secureshare_session": owner_sess},
    )
    assert perm_resp.status_code == 201
    perm_id = perm_resp.json()["id"]

    # Now collaborator can download
    dl_success = client.get(f"/api/files/{file_id}/download", cookies={"secureshare_session": collaborator_sess})
    assert dl_success.status_code == 200
    assert dl_success.content == b"%PDF-1.4 confidential plan"
    assert "Digest" in dl_success.headers

    # List permissions
    list_perm = client.get(f"/api/files/{file_id}/permissions", cookies={"secureshare_session": owner_sess})
    assert list_perm.status_code == 200
    assert len(list_perm.json()) == 1

    # Update permission to EDITOR
    patch_perm = client.patch(
        f"/api/permissions/{perm_id}",
        json={"role": "EDITOR"},
        cookies={"secureshare_session": owner_sess},
    )
    assert patch_perm.status_code == 200
    assert patch_perm.json()["role"] == "EDITOR"

    # Revoke permission
    del_perm = client.delete(f"/api/permissions/{perm_id}", cookies={"secureshare_session": owner_sess})
    assert del_perm.status_code == 204

    # Collaborator can no longer download
    dl_revoked = client.get(f"/api/files/{file_id}/download", cookies={"secureshare_session": collaborator_sess})
    assert dl_revoked.status_code == 404

def test_encryption_metadata_and_integrity(client):
    sess = create_user(client, "Crypto User", "crypto@example.com")
    content = b"Super secret cryptographic document payload."
    calc_sha = hashlib.sha256(content).hexdigest()

    upload_resp = client.post(
        "/api/files/upload",
        files={"file": ("classified.txt", content, "text/plain")},
        cookies={"secureshare_session": sess},
    )
    assert upload_resp.status_code == 201
    file_id = upload_resp.json()["id"]

    # Inspect encryption metadata
    meta_resp = client.get(f"/api/files/{file_id}/encryption/metadata", cookies={"secureshare_session": sess})
    assert meta_resp.status_code == 200
    meta = meta_resp.json()
    assert meta["algorithm"] == "AES-256-GCM"
    assert meta["key_length_bits"] == 256
    assert meta["sha256_checksum"] == calc_sha
    assert "nonce_hex" in meta
    # Ensure raw secret key is never leaked
    assert "data_key" not in meta
    assert "raw_key" not in meta

    # Verify endpoint
    verify_resp = client.post(
        f"/api/files/{file_id}/encryption/metadata",
        json={"sha256_checksum": calc_sha},
        cookies={"secureshare_session": sess},
    )
    assert verify_resp.status_code == 200
    assert verify_resp.json()["valid"] is True
    assert verify_resp.json()["checksum_verified"] is True

def test_audit_logs_and_notifications(client):
    sess = create_user(client, "Audit User", "audit@example.com")
    
    # Upload
    client.post(
        "/api/files",
        files={"file": ("log_test.txt", b"Log test content", "text/plain")},
        cookies={"secureshare_session": sess},
    )

    # Check global access logs
    logs_resp = client.get("/api/access-logs", cookies={"secureshare_session": sess})
    assert logs_resp.status_code == 200
    logs = logs_resp.json()
    assert len(logs) > 0
    assert any(l["action"] == "file.uploaded" for l in logs)

    # Check notifications and mark all read
    notifs_resp = client.get("/api/notifications", cookies={"secureshare_session": sess})
    assert notifs_resp.status_code == 200
    notifs = notifs_resp.json()
    assert len(notifs) > 0

    mark_resp = client.post("/api/notifications/mark-all-read", cookies={"secureshare_session": sess})
    assert mark_resp.status_code == 200
    after_notifs = client.get("/api/notifications", cookies={"secureshare_session": sess}).json()
    assert all(n["read"] is True for n in after_notifs)
