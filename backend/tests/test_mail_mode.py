from unittest.mock import MagicMock
import pytest
from app.core.config import settings
from app.main import send_email, sent_emails

def test_mail_mode_console(monkeypatch):
    monkeypatch.setattr(settings, "mail_mode", "console")
    sent_emails.clear()

    send_email("user@example.com", "Test Subject", "Test Body")
    assert len(sent_emails) == 1
    assert sent_emails[0]["to"] == "user@example.com"
    assert sent_emails[0]["subject"] == "Test Subject"
    assert sent_emails[0]["body"] == "Test Body"

def test_mail_mode_smtp_mocked(monkeypatch):
    monkeypatch.setattr(settings, "mail_mode", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "smtp.testserver.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "testuser")
    monkeypatch.setattr(settings, "smtp_password", "testpass")
    monkeypatch.setattr(settings, "smtp_use_tls", True)
    monkeypatch.setattr(settings, "mail_from", "noreply@cloudvault.com")

    mock_server = MagicMock()
    mock_smtp_cls = MagicMock()
    mock_smtp_cls.return_value.__enter__.return_value = mock_server

    monkeypatch.setattr("smtplib.SMTP", mock_smtp_cls)

    send_email("recipient@example.com", "Welcome", "Welcome to CloudVault")

    mock_smtp_cls.assert_called_with("smtp.testserver.com", 587, timeout=10)
    mock_server.starttls.assert_called_once()
    mock_server.login.assert_called_with("testuser", "testpass")
    mock_server.send_message.assert_called_once()

def test_mail_mode_smtp_missing_host_raises(monkeypatch):
    monkeypatch.setattr(settings, "mail_mode", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "")

    with pytest.raises(RuntimeError, match="SMTP_HOST is required"):
        send_email("user@example.com", "Test", "Test")
