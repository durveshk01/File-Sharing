import pytest
from app.main import sent_emails
from app.storage import LocalStorage

def create_verified_user(client, name, email, password):
    client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    return res.cookies.get("secureshare_session")

def test_file_ownership_isolation(client):
    sess_a = create_verified_user(client, "User A", "usera@example.com", "password123456")
    sess_b = create_verified_user(client, "User B", "userb@example.com", "password123456")

    # User A uploads a file
    file_content = b"User A private secret document"
    upload_res = client.post(
        "/api/files",
        files={"file": ("secret_a.txt", file_content, "text/plain")},
        cookies={"secureshare_session": sess_a},
    )
    assert upload_res.status_code == 201
    file_a_id = upload_res.json()["id"]

    # User A can get and download the file
    detail_a = client.get(f"/api/files/{file_a_id}", cookies={"secureshare_session": sess_a})
    assert detail_a.status_code == 200
    down_a = client.get(f"/api/files/{file_a_id}/download", cookies={"secureshare_session": sess_a})
    assert down_a.status_code == 200
    assert down_a.content == file_content

    # User B cannot get details, download, or delete User A's file
    detail_b = client.get(f"/api/files/{file_a_id}", cookies={"secureshare_session": sess_b})
    assert detail_b.status_code == 404

    down_b = client.get(f"/api/files/{file_a_id}/download", cookies={"secureshare_session": sess_b})
    assert down_b.status_code == 404

    del_b = client.delete(f"/api/files/{file_a_id}", cookies={"secureshare_session": sess_b})
    assert del_b.status_code == 404

    # File still exists for User A
    assert client.get(f"/api/files/{file_a_id}", cookies={"secureshare_session": sess_a}).status_code == 200

    # User B's file listing does not include User A's file
    list_b = client.get("/api/files", cookies={"secureshare_session": sess_b})
    assert list_b.status_code == 200
    assert len(list_b.json()) == 0

    # User B's dashboard stats show 0 files
    dash_b = client.get("/api/dashboard", cookies={"secureshare_session": sess_b})
    assert dash_b.status_code == 200
    assert dash_b.json()["stats"]["files"] == 0

def test_storage_path_traversal_defense():
    storage = LocalStorage()
    with pytest.raises(ValueError, match="Path traversal detected"):
        storage._resolve("../../../etc/passwd")
    with pytest.raises(ValueError, match="Path traversal detected"):
        storage._resolve("..\\..\\windows\\system32")
