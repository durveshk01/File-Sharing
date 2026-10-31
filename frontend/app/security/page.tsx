'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  KeyRound,
  LockKeyhole,
  Gauge,
  Files,
  Share2,
  Activity,
  ShieldCheck,
  Settings,
  LogOut,
  Smartphone,
  ShieldAlert,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function SecurityPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{
    secret: string;
    otpauth_url: string;
    recovery_codes: string[];
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);
  const router = useRouter();

  async function load() {
    const r = await fetch(`${API}/api/auth/sessions`, { credentials: 'include' });
    if (r.status === 401) {
      router.replace('/login');
      return;
    } else if (r.ok) {
      setSessions(await r.json());
    }

    const twoFaRes = await fetch(`${API}/api/auth/2fa/status`, { credentials: 'include' });
    if (twoFaRes.ok) {
      const data = await twoFaRes.json();
      setTwoFactorEnabled(data.enabled);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch(`${API}/api/auth/change-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setMsg('Password updated successfully. All other active sessions have been revoked.');
      (e.target as HTMLFormElement).reset();
      load();
    } else {
      const b = await r.json();
      setErr(b.detail || 'Could not update password');
    }
  }

  async function revokeSessions() {
    if (!confirm('Revoke all other active sessions? You will need to log back in.')) return;
    await fetch(`${API}/api/auth/sessions`, { method: 'DELETE', credentials: 'include' });
    router.replace('/login');
  }

  async function start2FASetup() {
    setMsg('');
    setErr('');
    const r = await fetch(`${API}/api/auth/2fa/setup`, {
      method: 'POST',
      credentials: 'include',
    });
    if (r.ok) {
      const data = await r.json();
      setTwoFactorSetup(data);
    } else {
      setErr('Could not initialize 2FA setup');
    }
  }

  async function confirm2FA(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const r = await fetch(`${API}/api/auth/2fa/enable`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: totpCode }),
    });
    if (r.ok) {
      setTwoFactorEnabled(true);
      setTwoFactorSetup(null);
      setTotpCode('');
      setMsg('Two-factor authentication (TOTP) successfully activated!');
    } else {
      const errorData = await r.json();
      setErr(errorData.detail || 'Invalid verification code');
    }
  }

  async function disable2FA(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const r = await fetch(`${API}/api/auth/2fa/disable`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: disablePassword, code: disableCode }),
    });
    if (r.ok) {
      setTwoFactorEnabled(false);
      setShowDisableForm(false);
      setDisablePassword('');
      setDisableCode('');
      setMsg('Two-factor authentication has been disabled.');
    } else {
      const errorData = await r.json();
      setErr(errorData.detail || 'Could not disable 2FA');
    }
  }

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <LockKeyhole size={17} />
          </span>
          SecureShare
        </Link>
        <div className="side-label">WORKSPACE</div>
        <Link className="side-item" href="/dashboard">
          <Gauge size={16} /> Overview
        </Link>
        <Link className="side-item" href="/files">
          <Files size={16} /> All Files
        </Link>
        <Link className="side-item" href="/shared">
          <Share2 size={16} /> Sharing Links
        </Link>
        <Link className="side-item" href="/access-logs">
          <Activity size={16} /> Audit Logs
        </Link>
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} /> Notifications
        </Link>

        <div className="side-label">ACCOUNT</div>
        <Link className="side-item active" href="/security">
          <KeyRound size={16} /> Security & 2FA
        </Link>
        <Link className="side-item" href="/settings">
          <Settings size={16} /> Settings
        </Link>
        <div className="sidebar-bottom">
          <button
            className="side-item"
            onClick={logout}
            style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-top">
          <strong>Security Management</strong>
          <span>Authentication, sessions & 2FA</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Account Security</h1>
              <p>Protect your account with Two-Factor Authentication (TOTP), Argon2id passwords, and active session control.</p>
            </div>
          </div>

          {msg && (
            <div style={{ padding: 12, borderRadius: 8, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', marginBottom: 18, fontSize: 13 }}>
              {msg}
            </div>
          )}
          {err && <div className="auth-error" style={{ marginBottom: 18 }}>{err}</div>}

          <div style={{ maxWidth: 840, display: 'grid', gap: 24 }}>
            {/* 2FA Panel */}
            <div className="panel">
              <div className="panel-title">
                <h3>Two-Factor Authentication (TOTP)</h3>
                {twoFactorEnabled ? (
                  <span className="badge badge-success">
                    <CheckCircle2 size={12} /> 2FA Active
                  </span>
                ) : (
                  <span className="badge badge-warning">Recommended</span>
                )}
              </div>

              {twoFactorEnabled ? (
                <div>
                  <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                    Your account is protected with time-based one-time passwords (TOTP). Signing in requires your password plus an authenticator token.
                  </p>
                  {!showDisableForm ? (
                    <button
                      className="btn-outline"
                      style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                      onClick={() => setShowDisableForm(true)}
                    >
                      Disable Two-Factor Authentication
                    </button>
                  ) : (
                    <form onSubmit={disable2FA} style={{ marginTop: 16, maxWidth: 440 }}>
                      <div className="field">
                        <label>Confirm Account Password</label>
                        <input
                          type="password"
                          required
                          value={disablePassword}
                          onChange={(e) => setDisablePassword(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label>6-Digit Authenticator Code or Recovery Code</label>
                        <input
                          type="text"
                          required
                          placeholder="123456 or a1b2c3d4"
                          value={disableCode}
                          onChange={(e) => setDisableCode(e.target.value)}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button className="button" style={{ background: '#dc2626' }}>
                          Confirm Disable
                        </button>
                        <button type="button" className="btn-outline" onClick={() => setShowDisableForm(false)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : twoFactorSetup ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ background: '#eff6ff', padding: 14, borderRadius: 8, border: '1px solid #bfdbfe', marginBottom: 16 }}>
                    <strong style={{ fontSize: 13, color: '#1e40af' }}>Step 1: Link Authenticator App</strong>
                    <p style={{ fontSize: 12, color: '#1e3a8a', margin: '4px 0 10px' }}>
                      Add this secret key to your authenticator app (Google Authenticator, Authy, 1Password):
                    </p>
                    <code style={{ display: 'inline-block', padding: '6px 12px', background: '#fff', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: 14, letterSpacing: 1.5, color: '#2563eb' }}>
                      {twoFactorSetup.secret}
                    </code>
                    <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                      URI: {twoFactorSetup.otpauth_url}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>Step 2: Save Emergency Recovery Codes</strong>
                    <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 10px' }}>
                      Keep these single-use codes stored in a password manager. They can restore access if you lose your device.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {twoFactorSetup.recovery_codes.map((code, idx) => (
                        <code key={idx} style={{ background: '#fff', padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, textAlign: 'center' }}>
                          {code}
                        </code>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={confirm2FA} style={{ maxWidth: 440 }}>
                    <div className="field">
                      <label>Step 3: Enter 6-Digit Code from Authenticator</label>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="123456"
                        required
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.trim())}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <button className="button">Activate 2FA Protection</button>
                      <button type="button" className="btn-outline" onClick={() => setTwoFactorSetup(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
                    Require a 6-digit verification code from your mobile device every time you sign in to SecureShare.
                  </p>
                  <button className="button" onClick={start2FASetup}>
                    <Smartphone size={15} /> Set up Two-Factor Authentication
                  </button>
                </div>
              )}
            </div>

            {/* Password Change Panel */}
            <div className="panel">
              <div className="panel-title">
                <h3>Change Password</h3>
              </div>

              <form onSubmit={changePassword} style={{ maxWidth: 440 }}>
                <div className="field">
                  <label htmlFor="current-pw">Current Password</label>
                  <input id="current-pw" type="password" name="current_password" required />
                </div>
                <div className="field">
                  <label htmlFor="new-pw">New Password (12+ characters)</label>
                  <input id="new-pw" type="password" name="new_password" minLength={12} required />
                </div>
                <button className="button" style={{ marginTop: 8 }}>
                  Update Password
                </button>
              </form>
            </div>

            {/* Active Sessions Panel */}
            <div className="panel">
              <div className="panel-title">
                <h3>Active Browser Sessions ({sessions.length})</h3>
                <button
                  className="btn-outline btn-sm"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={revokeSessions}
                >
                  Revoke All Sessions
                </button>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                {sessions.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <strong style={{ color: '#0f172a' }}>Authenticated Session</strong>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                        Expires: {new Date(s.expires_at).toLocaleString()}
                      </div>
                    </div>
                    <span className="badge badge-success">Active</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
