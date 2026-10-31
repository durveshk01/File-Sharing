import concurrent.futures
from app.main import sent_emails

def test_concurrent_download_limit_enforcement(client):
    # Setup owner and file
    client.post("/api/auth/register", json={"name": "Conc User", "email": "conc@example.com", "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": "conc@example.com", "password": "password123456"})
    session = res.cookies.get("secureshare_session")
    
    upload = client.post(
        "/api/files",
        files={"file": ("limited.txt", b"Download this limited file", "text/plain")},
        cookies={"secureshare_session": session},
    )
    file_id = upload.json()["id"]

    # Create share link with max_downloads = 3
    share_res = client.post(
        f"/api/files/{file_id}/shares",
        json={"max_downloads": 3},
        cookies={"secureshare_session": session},
    )
    token = share_res.json()["url"].split("/share/")[1]

    # Spawn 10 concurrent requests to download
    results = []
    def do_download():
        r = client.post(f"/api/shares/{token}/download")
        return r.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(do_download) for _ in range(10)]
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())

    # Exactly 3 should succeed (200), remaining 7 should fail (410 or 404)
    successes = [s for s in results if s == 200]
    failures = [s for s in results if s in (404, 410)]

    assert len(successes) == 3, f"Expected exactly 3 downloads to succeed, got {len(successes)} (results: {results})"
    assert len(failures) == 7, f"Expected 7 download attempts to fail, got {len(failures)}"

    # Subsequent request must also fail
    assert client.post(f"/api/shares/{token}/download").status_code in (404, 410)
