import pytest
from datetime import datetime, timedelta, timezone
from app.main import sent_emails

def create_user_and_upload(client, name="Share Owner", email="owner@example.com"):
    client.post("/api/auth/register", json={"name": name, "email": email, "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": email, "password": "password123456"})
    session = res.cookies.get("secureshare_session")
    
    upload = client.post(
        "/api/files",
        files={"file": ("shared_doc.txt", b"Shared confidential content", "text/plain")},
        cookies={"secureshare_session": session},
    )
    return session, upload.json()["id"]

def test_public_share_flow(client):
    session, file_id = create_user_and_upload(client)

    # 1. Create a share link without password
    share_resp = client.post(
        f"/api/files/{file_id}/shares",
        json={"expires_in_hours": 24, "max_downloads": 5},
        cookies={"secureshare_session": session},
    )
    assert share_resp.status_code == 201
    url = share_resp.json()["url"]
    token = url.split("/share/")[1]

    # 2. Inspect share as recipient (anonymous)
    inspect_resp = client.get(f"/api/shares/{token}")
    assert inspect_resp.status_code == 200
    inspect_data = inspect_resp.json()
    assert inspect_data["name"] == "shared_doc.txt"
    assert inspect_data["password_required"] is False

    # 3. Download via share link
    download_resp = client.post(f"/api/shares/{token}/download")
    assert download_resp.status_code == 200
    assert download_resp.content == b"Shared confidential content"

    # 4. Check owner's notifications & activity
    notifs = client.get("/api/notifications", cookies={"secureshare_session": session})
    assert any("shared file was downloaded" in n["message"] for n in notifs.json())

def test_password_protected_share_flow(client):
    session, file_id = create_user_and_upload(client, name="Secured Share", email="secure_share@example.com")

    # 1. Create a share with password
    share_resp = client.post(
        f"/api/files/{file_id}/shares",
        json={"password": "SharePassword123!"},
        cookies={"secureshare_session": session},
    )
    assert share_resp.status_code == 201
    token = share_resp.json()["url"].split("/share/")[1]

    # 2. Inspect confirms password required
    inspect_resp = client.get(f"/api/shares/{token}")
    assert inspect_resp.status_code == 200
    assert inspect_resp.json()["password_required"] is True

    # 3. Direct download fails with 403
    unauth_dl = client.post(f"/api/shares/{token}/download")
    assert unauth_dl.status_code == 403

    # 4. Verify password with wrong password
    wrong_pw = client.post(f"/api/shares/{token}/verify", json={"password": "WrongPassword"})
    assert wrong_pw.status_code == 403

    # 5. Verify password with correct password
    verify_pw = client.post(f"/api/shares/{token}/verify", json={"password": "SharePassword123!"})
    assert verify_pw.status_code == 200
    grant = verify_pw.json()["grant"]

    # 6. Download with grant header succeeds
    auth_dl = client.post(f"/api/shares/{token}/download", headers={"X-Share-Grant": grant})
    assert auth_dl.status_code == 200
    assert auth_dl.content == b"Shared confidential content"

def test_share_revocation(client):
    session, file_id = create_user_and_upload(client, name="Revoke Test", email="revoke@example.com")

    share_resp = client.post(
        f"/api/files/{file_id}/shares",
        json={},
        cookies={"secureshare_session": session},
    )
    token = share_resp.json()["url"].split("/share/")[1]

    # Get share ID from list
    shares_list = client.get("/api/shares", cookies={"secureshare_session": session}).json()
    share_id = shares_list[0]["id"]

    # Download works
    assert client.post(f"/api/shares/{token}/download").status_code == 200

    # Revoke share
    revoke_resp = client.delete(f"/api/shares/{share_id}", cookies={"secureshare_session": session})
    assert revoke_resp.status_code == 204

    # Download fails after revocation
    assert client.post(f"/api/shares/{token}/download").status_code == 404
    assert client.get(f"/api/shares/{token}").status_code == 404
