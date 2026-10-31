import json
from app.main import sent_emails
from app.totp import get_totp_code

def test_two_factor_auth_lifecycle(client):
    # 1. Register & verify user
    client.post("/api/auth/register", json={"name": "2FA User", "email": "2fa@example.com", "password": "password123456"})
    token = sent_emails[-1]["body"].split("token=")[1].strip()
    client.post("/api/auth/verify-email", json={"token": token})

    # Login
    login1 = client.post("/api/auth/login", json={"email": "2fa@example.com", "password": "password123456"})
    sess = login1.cookies.get("secureshare_session")

    # Check 2FA status
    status = client.get("/api/auth/2fa/status", cookies={"secureshare_session": sess})
    assert status.status_code == 200
    assert status.json()["enabled"] is False

    # 2. Setup 2FA
    setup_res = client.post("/api/auth/2fa/setup", cookies={"secureshare_session": sess})
    assert setup_res.status_code == 200
    setup_data = setup_res.json()
    secret = setup_data["secret"]
    recovery_codes = setup_data["recovery_codes"]
    assert len(recovery_codes) == 8
    assert "otpauth://" in setup_data["otpauth_url"]

    # 3. Enable with invalid code fails
    fail_enable = client.post("/api/auth/2fa/enable", json={"code": "000000"}, cookies={"secureshare_session": sess})
    assert fail_enable.status_code == 400

    # 4. Enable with valid TOTP code
    valid_code = get_totp_code(secret)
    ok_enable = client.post("/api/auth/2fa/enable", json={"code": valid_code}, cookies={"secureshare_session": sess})
    assert ok_enable.status_code == 200
    assert ok_enable.json()["enabled"] is True

    # Status is now true
    assert client.get("/api/auth/2fa/status", cookies={"secureshare_session": sess}).json()["enabled"] is True

    # 5. Logout
    client.post("/api/auth/logout", cookies={"secureshare_session": sess})

    # 6. Login step 1: enters email & password
    login_step1 = client.post("/api/auth/login", json={"email": "2fa@example.com", "password": "password123456"})
    assert login_step1.status_code == 200
    step1_data = login_step1.json()
    assert step1_data["require_2fa"] is True
    assert "challenge_token" in step1_data
    assert "secureshare_session" not in login_step1.cookies

    challenge = step1_data["challenge_token"]

    # 7. Complete login with invalid TOTP code
    fail_step2 = client.post("/api/auth/login/2fa", json={"challenge_token": challenge, "code": "999999"})
    assert fail_step2.status_code == 401

    # 8. Complete login with valid TOTP code
    valid_code = get_totp_code(secret)
    ok_step2 = client.post("/api/auth/login/2fa", json={"challenge_token": challenge, "code": valid_code})
    assert ok_step2.status_code == 200
    assert "secureshare_session" in ok_step2.cookies
    new_sess = ok_step2.cookies.get("secureshare_session")

    # Can access /me
    assert client.get("/api/auth/me", cookies={"secureshare_session": new_sess}).status_code == 200

    # 9. Test Recovery Code login
    client.post("/api/auth/logout", cookies={"secureshare_session": new_sess})
    rc_step1 = client.post("/api/auth/login", json={"email": "2fa@example.com", "password": "password123456"}).json()
    rc_challenge = rc_step1["challenge_token"]

    first_recovery_code = recovery_codes[0]
    rc_step2 = client.post("/api/auth/login/2fa", json={"challenge_token": rc_challenge, "code": first_recovery_code})
    assert rc_step2.status_code == 200
    assert "secureshare_session" in rc_step2.cookies
    rc_sess = rc_step2.cookies.get("secureshare_session")

    # Consuming the same recovery code again must fail
    client.post("/api/auth/logout", cookies={"secureshare_session": rc_sess})
    rc_step1_b = client.post("/api/auth/login", json={"email": "2fa@example.com", "password": "password123456"}).json()
    reuse_fail = client.post("/api/auth/login/2fa", json={"challenge_token": rc_step1_b["challenge_token"], "code": first_recovery_code})
    assert reuse_fail.status_code == 401

    # Login with another recovery code to disable 2FA
    second_recovery_code = recovery_codes[1]
    rc_step2_b = client.post("/api/auth/login/2fa", json={"challenge_token": rc_step1_b["challenge_token"], "code": second_recovery_code})
    assert rc_step2_b.status_code == 200
    sess_b = rc_step2_b.cookies.get("secureshare_session")

    # 10. Disable 2FA
    valid_code = get_totp_code(secret)
    disable_res = client.post(
        "/api/auth/2fa/disable",
        json={"password": "password123456", "code": valid_code},
        cookies={"secureshare_session": sess_b},
    )
    assert disable_res.status_code == 200
    assert disable_res.json()["enabled"] is False

    # After disabling, normal login succeeds directly
    client.post("/api/auth/logout", cookies={"secureshare_session": sess_b})
    direct_login = client.post("/api/auth/login", json={"email": "2fa@example.com", "password": "password123456"})
    assert direct_login.status_code == 200
    assert "require_2fa" not in direct_login.json()
    assert "secureshare_session" in direct_login.cookies
