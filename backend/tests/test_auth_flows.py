import pytest
from app.main import sent_emails

def test_full_registration_email_verification_and_login_flow(client):
    # 1. Register a new user
    reg_resp = client.post(
        "/api/auth/register",
        json={"name": "Alice Smith", "email": "alice@example.com", "password": "password123456"},
    )
    assert reg_resp.status_code == 201
    reg_data = reg_resp.json()
    assert reg_data["email"] == "alice@example.com"
    assert reg_data["verification_required"] is True

    # Check that verification email was sent
    assert len(sent_emails) == 1
    verify_email_msg = sent_emails[0]
    assert verify_email_msg["to"] == "alice@example.com"
    assert "token=" in verify_email_msg["body"]

    # Extract token
    token = verify_email_msg["body"].split("token=")[1].strip()

    # 2. Try to login before verification -> should fail with 403
    pre_login = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "password123456"},
    )
    assert pre_login.status_code == 403
    assert "Verify your email" in pre_login.json()["detail"]

    # 3. Verify email with token
    verify_resp = client.post("/api/auth/verify-email", json={"token": token})
    assert verify_resp.status_code == 200
    assert verify_resp.json()["email"] == "alice@example.com"
    # Verification also issues session cookie
    assert "secureshare_session" in verify_resp.cookies

    # 4. Access protected route /api/auth/me
    me_resp = client.get("/api/auth/me", cookies=verify_resp.cookies)
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "alice@example.com"

    # 5. Subsequent login with email & password works
    login_resp = client.post(
        "/api/auth/login",
        json={"email": "alice@example.com", "password": "password123456"},
    )
    assert login_resp.status_code == 200
    assert "secureshare_session" in login_resp.cookies

def test_resend_verification_flow(client):
    # Register user
    client.post(
        "/api/auth/register",
        json={"name": "Bob", "email": "bob@example.com", "password": "password123456"},
    )
    sent_emails.clear()

    # Resend verification
    resend_resp = client.post(
        "/api/auth/resend-verification",
        json={"email": "bob@example.com"},
    )
    assert resend_resp.status_code == 200
    assert len(sent_emails) == 1
    new_token = sent_emails[0]["body"].split("token=")[1].strip()

    # Verify with new token
    verify_resp = client.post("/api/auth/verify-email", json={"token": new_token})
    assert verify_resp.status_code == 200

def test_forgot_and_reset_password_flow(client):
    # Setup verified user
    client.post(
        "/api/auth/register",
        json={"name": "Carol", "email": "carol@example.com", "password": "oldpassword123"},
    )
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})
    sent_emails.clear()

    # Login to create an active session
    login1 = client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "oldpassword123"},
    )
    session1 = login1.cookies.get("secureshare_session")

    # Request password reset
    forgot_resp = client.post(
        "/api/auth/forgot-password",
        json={"email": "carol@example.com"},
    )
    assert forgot_resp.status_code == 200
    assert len(sent_emails) == 1
    reset_token = sent_emails[0]["body"].split("token=")[1].strip()

    # Reset password
    reset_resp = client.post(
        "/api/auth/reset-password",
        json={"token": reset_token, "new_password": "newpassword12345"},
    )
    assert reset_resp.status_code == 200

    # Verify old session was revoked
    check_session = client.get("/api/auth/me", cookies={"secureshare_session": session1})
    assert check_session.status_code == 401

    # Login with old password fails
    old_login = client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "oldpassword123"},
    )
    assert old_login.status_code == 401

    # Login with new password succeeds
    new_login = client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "newpassword12345"},
    )
    assert new_login.status_code == 200

def test_invalid_and_reused_tokens(client):
    # Invalid token
    resp = client.post("/api/auth/verify-email", json={"token": "invalid_fake_token"})
    assert resp.status_code == 400

    # Register and verify
    client.post(
        "/api/auth/register",
        json={"name": "Dan", "email": "dan@example.com", "password": "password123456"},
    )
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    ok_resp = client.post("/api/auth/verify-email", json={"token": token})
    assert ok_resp.status_code == 200

    # Reusing the token must fail
    reuse_resp = client.post("/api/auth/verify-email", json={"token": token})
    assert reuse_resp.status_code == 400

def test_change_password_revokes_other_sessions(client):
    # Register and verify
    client.post(
        "/api/auth/register",
        json={"name": "Eve", "email": "eve@example.com", "password": "password123456"},
    )
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})

    # Create two sessions
    sess1 = client.post(
        "/api/auth/login",
        json={"email": "eve@example.com", "password": "password123456"},
    ).cookies.get("secureshare_session")

    sess2 = client.post(
        "/api/auth/login",
        json={"email": "eve@example.com", "password": "password123456"},
    ).cookies.get("secureshare_session")

    # Change password using session 2
    change_resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "password123456", "new_password": "updatedsecretpassword"},
        cookies={"secureshare_session": sess2},
    )
    assert change_resp.status_code == 204

    # Session 2 should remain valid
    assert client.get("/api/auth/me", cookies={"secureshare_session": sess2}).status_code == 200
    # Session 1 should be revoked
    assert client.get("/api/auth/me", cookies={"secureshare_session": sess1}).status_code == 401
