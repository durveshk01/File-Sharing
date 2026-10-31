import pytest
from app.main import sent_emails

def test_resumable_chunked_upload_flow(client):
    # Setup user
    client.post("/api/auth/register", json={"name": "Chunk User", "email": "chunks@example.com", "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": "chunks@example.com", "password": "password123456"})
    sess = res.cookies.get("secureshare_session")

    chunk1 = b"Chunk 0 content; "
    chunk2 = b"Chunk 1 content; "
    chunk3 = b"Chunk 2 content."
    full_data = chunk1 + chunk2 + chunk3

    # 1. Init upload
    init_res = client.post(
        "/api/files/resumable/init",
        json={
            "name": "resumable_document.txt",
            "size": len(full_data),
            "content_type": "text/plain",
            "total_chunks": 3,
        },
        cookies={"secureshare_session": sess},
    )
    assert init_res.status_code == 201
    upload_id = init_res.json()["upload_id"]

    # 2. Upload chunks out of order (0, then 2, then 1)
    res_c0 = client.put(
        f"/api/files/resumable/{upload_id}/chunk/0",
        content=chunk1,
        cookies={"secureshare_session": sess},
    )
    assert res_c0.status_code == 200

    res_c2 = client.put(
        f"/api/files/resumable/{upload_id}/chunk/2",
        content=chunk3,
        cookies={"secureshare_session": sess},
    )
    assert res_c2.status_code == 200

    # Status check before completing
    status1 = client.get(f"/api/files/resumable/{upload_id}/status", cookies={"secureshare_session": sess})
    assert status1.status_code == 200
    assert status1.json()["completed_chunks"] == [0, 2]
    assert status1.json()["complete"] is False

    # Attempting to complete before all chunks are present fails
    premature_complete = client.post(f"/api/files/resumable/{upload_id}/complete", cookies={"secureshare_session": sess})
    assert premature_complete.status_code == 400

    # Upload missing chunk 1
    res_c1 = client.put(
        f"/api/files/resumable/{upload_id}/chunk/1",
        content=chunk2,
        cookies={"secureshare_session": sess},
    )
    assert res_c1.status_code == 200

    # Status check now shows all chunks complete
    status2 = client.get(f"/api/files/resumable/{upload_id}/status", cookies={"secureshare_session": sess})
    assert status2.json()["complete"] is True

    # 3. Complete upload
    complete_res = client.post(f"/api/files/resumable/{upload_id}/complete", cookies={"secureshare_session": sess})
    assert complete_res.status_code == 201
    file_id = complete_res.json()["id"]

    # 4. Download and verify assembled content
    download_res = client.get(f"/api/files/{file_id}/download", cookies={"secureshare_session": sess})
    assert download_res.status_code == 200
    assert download_res.content == full_data

def test_abort_resumable_upload(client):
    # Setup user
    client.post("/api/auth/register", json={"name": "Abort User", "email": "abort@example.com", "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": "abort@example.com", "password": "password123456"})
    sess = res.cookies.get("secureshare_session")

    init_res = client.post(
        "/api/files/resumable/init",
        json={"name": "abort.txt", "size": 100, "content_type": "text/plain", "total_chunks": 2},
        cookies={"secureshare_session": sess},
    )
    upload_id = init_res.json()["upload_id"]

    # Upload chunk 0
    client.put(f"/api/files/resumable/{upload_id}/chunk/0", content=b"A" * 50, cookies={"secureshare_session": sess})

    # Abort
    abort_res = client.delete(f"/api/files/resumable/{upload_id}", cookies={"secureshare_session": sess})
    assert abort_res.status_code == 204

    # Status returns 404
    assert client.get(f"/api/files/resumable/{upload_id}/status", cookies={"secureshare_session": sess}).status_code == 404
