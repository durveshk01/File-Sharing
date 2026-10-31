import pytest
from app.main import sent_emails
from app.mime_validator import validate_file_content

def test_mime_content_validation():
    # Valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 30
    is_valid, detected, _ = validate_file_content(png_bytes, "image/png", "photo.png")
    assert is_valid is True
    assert detected == "image/png"

    # Valid JPEG
    jpeg_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 20
    is_valid, detected, _ = validate_file_content(jpeg_bytes, "image/jpeg", "photo.jpg")
    assert is_valid is True
    assert detected == "image/jpeg"

    # Valid PDF
    pdf_bytes = b"%PDF-1.4\n" + b"sample pdf content"
    is_valid, detected, _ = validate_file_content(pdf_bytes, "application/pdf", "document.pdf")
    assert is_valid is True
    assert detected == "application/pdf"

    # Malicious executable pretending to be image/jpeg
    fake_img = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 50
    is_valid, _, err = validate_file_content(fake_img, "image/jpeg", "innocent_picture.jpg")
    assert is_valid is False
    assert "dangerous format" in err

    # Executable pretending to be plain text
    fake_txt = b"\x7fELF" + b"\x01\x01\x01\x00" * 10
    is_valid, _, err = validate_file_content(fake_txt, "text/plain", "notes.txt")
    assert is_valid is False
    assert "dangerous format" in err

def test_api_rejects_disguised_executable(client):
    # Setup user
    client.post("/api/auth/register", json={"name": "Mime User", "email": "mime@example.com", "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    res = client.post("/api/auth/login", json={"email": "mime@example.com", "password": "password123456"})
    sess = res.cookies.get("secureshare_session")

    # Malicious payload with Windows PE magic bytes
    malicious_bytes = b"MZ\x90\x00" + b"\x00" * 100
    upload_res = client.post(
        "/api/files",
        files={"file": ("malicious.jpg", malicious_bytes, "image/jpeg")},
        cookies={"secureshare_session": sess},
    )
    assert upload_res.status_code == 400
    assert "dangerous format" in upload_res.json()["detail"]
