from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.main import sent_emails
from app.models import OneTimeToken, User
from app.security import COOKIE, digest
from app.totp import get_totp_code


PASSWORD = "a-long-private-password"


def verified_account(client, email="security@example.com"):
    response = client.post("/api/auth/register", json={"name": "Security Test", "email": email, "password": PASSWORD})
    assert response.status_code == 201
    verification = sent_emails[-1]["body"].split("token=")[1].strip()
    response = client.post("/api/auth/verify-email", json={"token": verification})
    assert response.status_code == 200
    client.cookies.clear()
    return response.json(), {"Authorization": f"Bearer {response.json()['token']}"}


def test_demo_visitors_have_isolated_accounts_and_files(client):
    first = client.post("/api/auth/demo").json()
    client.cookies.clear()
    first_auth = {"Authorization": f"Bearer {first['token']}"}
    upload = client.post("/api/files", files={"file": ("private.txt", b"First visitor's private data", "text/plain")}, headers=first_auth)
    assert upload.status_code == 201
    second = client.post("/api/auth/demo").json()
    client.cookies.clear()
    second_auth = {"Authorization": f"Bearer {second['token']}"}
    assert first["id"] != second["id"]
    assert first["email"] != second["email"]
    assert client.get("/api/files", headers=second_auth).json() == []
    assert client.get(f"/api/files/{upload.json()['id']}", headers=second_auth).status_code == 404
    assert client.delete(f"/api/files/{upload.json()['id']}", headers=second_auth).status_code == 404


def test_bearer_logout_revokes_token_even_with_unrelated_cookie(client):
    _, headers = verified_account(client)
    client.cookies.set(COOKIE, "unrelated-stale-cookie")
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_bearer_password_change_keeps_current_session_and_revokes_others(client):
    _, first_headers = verified_account(client)
    login = client.post("/api/auth/login", json={"email": "security@example.com", "password": PASSWORD}).json()
    client.cookies.clear()
    second_headers = {"Authorization": f"Bearer {login['token']}"}
    response = client.post("/api/auth/change-password", headers=second_headers, json={
        "current_password": PASSWORD, "new_password": "a-new-long-private-password",
    })
    assert response.status_code == 204
    assert client.get("/api/auth/me", headers=second_headers).status_code == 200
    assert client.get("/api/auth/me", headers=first_headers).status_code == 401


def test_enabled_totp_cannot_be_reset_by_setup(client, db):
    account, headers = verified_account(client)
    setup = client.post("/api/auth/2fa/setup", headers=headers).json()
    stored = db.get(User, account["id"])
    assert stored.totp_secret.startswith("enc:v1:")
    assert setup["secret"] not in stored.totp_secret
    assert client.post("/api/auth/2fa/enable", headers=headers, json={"code": get_totp_code(setup["secret"])}).status_code == 200
    response = client.post("/api/auth/2fa/setup", headers=headers)
    assert response.status_code == 409
    assert client.get("/api/auth/2fa/status", headers=headers).json()["enabled"] is True
    login = client.post("/api/auth/login", json={"email": account["email"], "password": PASSWORD}).json()
    assert login["require_2fa"] is True
    assert client.post("/api/auth/login/2fa", json={"challenge_token": login["challenge_token"], "code": get_totp_code(setup["secret"])}).status_code == 200
    assert client.post("/api/auth/login/2fa", json={"challenge_token": login["challenge_token"], "code": get_totp_code(setup["secret"])}).status_code == 400


def test_password_change_invalidates_existing_two_factor_challenge(client, db):
    account, headers = verified_account(client)
    setup = client.post("/api/auth/2fa/setup", headers=headers).json()
    client.post("/api/auth/2fa/enable", headers=headers, json={"code": get_totp_code(setup["secret"])})
    challenge = client.post("/api/auth/login", json={"email": account["email"], "password": PASSWORD}).json()["challenge_token"]
    record = db.scalar(select(OneTimeToken).where(OneTimeToken.token_hash == digest(challenge)))
    expiry = record.expires_at.replace(tzinfo=timezone.utc) if record.expires_at.tzinfo is None else record.expires_at
    assert expiry < datetime.now(timezone.utc) + timedelta(minutes=6)
    client.post("/api/auth/change-password", headers=headers, json={"current_password": PASSWORD, "new_password": "a-new-long-private-password"})
    assert client.post("/api/auth/login/2fa", json={"challenge_token": challenge, "code": get_totp_code(setup["secret"])}).status_code == 400


def test_csrf_and_cors_only_trust_explicit_frontend_origins(client):
    _, headers = verified_account(client)
    for origin in ("https://attacker.vercel.app", "https://frontend-five-fawn-27.vercel.app.evil.example", "null"):
        response = client.post("/api/auth/logout", headers={"Origin": origin, **headers})
        assert response.status_code == 403
        assert "access-control-allow-origin" not in response.headers
    response = client.get("/api/auth/me", headers={"Origin": "https://attacker.vercel.app", **headers})
    assert "access-control-allow-origin" not in response.headers
    assert client.get("/api/auth/me", headers=headers).status_code == 200


def test_revoking_a_device_invalidates_only_its_bound_sessions(client):
    _, first_headers = verified_account(client)
    second_login = client.post("/api/auth/login", json={"email": "security@example.com", "password": PASSWORD}).json()
    client.cookies.clear()
    second_headers = {"Authorization": f"Bearer {second_login['token']}"}
    assert client.post("/api/sync/device/register", headers=first_headers, json={
        "device_id": "device-one", "device_name": "First phone", "device_type": "mobile",
    }).status_code == 200
    assert client.post("/api/sync/device/register", headers=second_headers, json={
        "device_id": "device-two", "device_name": "Second phone", "device_type": "mobile",
    }).status_code == 200
    assert client.delete("/api/sync/devices/device-one", headers=second_headers).status_code == 204
    assert client.get("/api/auth/me", headers=first_headers).status_code == 401
    assert client.get("/api/auth/me", headers=second_headers).status_code == 200
    assert client.post("/api/sync/device/register", headers=second_headers, json={
        "device_id": "device-one", "device_name": "Revoked phone", "device_type": "mobile",
    }).status_code == 409
