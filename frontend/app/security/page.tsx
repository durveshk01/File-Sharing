'use client';

import { API } from '../api';
import DeviceManager from '../components/device-manager';
import { apiRequest, clearBrowserSession } from '../lib/api';

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
    try {
      const [r, twoFaRes] = await Promise.all([
        fetch(`${API}/api/auth/sessions`, { credentials: 'include' }),
        fetch(`${API}/api/auth/2fa/status`, { credentials: 'include' }),
      ]);
      if (r.status === 401 || twoFaRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (!r.ok || !twoFaRes.ok) throw new Error('Could not load security settings. Try again.');
      const [sessionData, twoFaData] = await Promise.all([r.json(), twoFaRes.json()]);
      setSessions(sessionData.filter((session: { expires_at: string }) => new Date(session.expires_at) > new Date()));
      setTwoFactorEnabled(twoFaData.enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load security settings. Try again.');
    }

  }

  useEffect(() => {
    load();
  }, []);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const r = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const response = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(response.detail || 'Could not update password. Try again.');
      setMsg('Password updated successfully. All other active sessions have been revoked.');
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update password. Try again.');
    }
  }

  async function revokeSessions() {
    if (!confirm('Revoke all sessions, including this one? You will be signed out.')) return;
    try {
      const response = await fetch(`${API}/api/auth/sessions`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Could not revoke sessions. Try again.');
      clearBrowserSession();
      router.replace('/login');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not revoke sessions. Try again.');
    }
  }

  async function start2FASetup() {
    setMsg('');
    setErr('');
    try {
      const r = await fetch(`${API}/api/auth/2fa/setup`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Could not initialize 2FA setup. Try again.');
      setTwoFactorSetup(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not initialize 2FA setup. Try again.');
    }
  }

  async function confirm2FA(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      const r = await fetch(`${API}/api/auth/2fa/enable`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      });
      const errorData = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorData.detail || 'Invalid verification code');
      setTwoFactorEnabled(true);
      setTwoFactorSetup(null);
      setTotpCode('');
      setMsg('Two-factor authentication (TOTP) successfully activated!');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enable 2FA. Try again.');
    }
  }

  async function disable2FA(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    try {
      const r = await fetch(`${API}/api/auth/2fa/disable`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const errorData = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorData.detail || 'Could not disable 2FA. Try again.');
      setTwoFactorEnabled(false);
      setShowDisableForm(false);
      setDisablePassword('');
      setDisableCode('');
      setMsg('Two-factor authentication has been disabled.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not disable 2FA. Try again.');
    }
  }

  async function logout() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); clearBrowserSession(); router.replace('/'); }
    catch (error) { setErr(error instanceof Error ? error.message : 'Could not sign out'); }
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
            <div role="status" aria-live="polite" style={{ padding: 12, borderRadius: 8, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', marginBottom: 18, fontSize: 13 }}>
              {msg}
            </div>
          )}
          {err && <div className="auth-error" role="alert" style={{ marginBottom: 18 }}>{err}</div>}

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
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
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
                        <label htmlFor="disable-password">Confirm Account Password</label>
                        <input
                          id="disable-password"
                          type="password"
                          required
                          value={disablePassword}
                          onChange={(e) => setDisablePassword(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="disable-code">6-Digit Authenticator Code or Recovery Code</label>
                        <input
                          id="disable-code"
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
                  <div style={{ background: 'var(--primary-subtle)', padding: 14, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Step 1: Link Authenticator App</strong>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
                      Add this secret key to your authenticator app (Google Authenticator, Authy, 1Password):
                    </p>
                    <code style={{ display: 'inline-block', padding: '6px 12px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 14, letterSpacing: 1.5, color: 'var(--text-primary)' }}>
                      {twoFactorSetup.secret}
                    </code>
                    <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                      URI: {twoFactorSetup.otpauth_url}
                    </div>
                  </div>

                  <div style={{ background: 'var(--surface-raised)', padding: 14, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Step 2: Save Emergency Recovery Codes</strong>
                    <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 10px' }}>
                      Keep these single-use codes stored in a password manager. They can restore access if you lose your device.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', gap: 8 }}>
                      {twoFactorSetup.recovery_codes.map((code, idx) => (
                        <code key={idx} style={{ background: 'var(--surface)', color: 'var(--text-primary)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12, textAlign: 'center' }}>
                          {code}
                        </code>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={confirm2FA} style={{ maxWidth: 440 }}>
                    <div className="field">
                      <label htmlFor="setup-code">Step 3: Enter 6-Digit Code from Authenticator</label>
                      <input
                        id="setup-code"
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

            <DeviceManager />

            {/* Active Sessions Panel */}
            <div className="panel">
              <div className="panel-title">
                <h3>Active sessions ({sessions.length})</h3>
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
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Authenticated Session</strong>
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
