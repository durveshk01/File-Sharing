'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, ArrowRight, ShieldCheck, Mail, Sparkles, KeyRound } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));

    if (mode === 'register') {
      if (data.password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setBusy(true);
    try {
      const payload: Record<string, any> = {
        email: data.email,
        password: data.password,
      };
      if (mode === 'register') {
        payload.name = data.name;
      }

      const r = await fetch(`${API}/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) {
        throw new Error(body.detail || 'Could not complete request');
      }

      if (mode === 'register') {
        setRegisteredEmail(String(data.email));
        return;
      }

      if (body.require_2fa) {
        setChallengeToken(body.challenge_token);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setBusy(false);
    }
  }

  async function submit2FA(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/auth/login/2fa`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_token: challengeToken,
          code: twoFactorCode,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        throw new Error(body.detail || 'Invalid authentication code');
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setBusy(false);
    }
  }

  async function demoLogin() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/auth/demo`, { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('Demo access is currently unavailable');
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <LockKeyhole size={18} />
          </span>
          SecureShare
        </Link>
        <div className="auth-message">
          <div className="eyebrow">YOUR FILES. YOUR PRIVACY. YOUR CONTROL.</div>
          <h1>Private by design. Controlled by you.</h1>
          <p>
            Authenticated AES-256-GCM file encryption, isolated envelope key wrapping, and revocable high-entropy sharing links.
          </p>
        </div>
        <div className="auth-bottom">AES-256-GCM AEAD · Argon2id Hashing · Zero AI Telemetry</div>
      </aside>

      <section className="auth-form-side">
        {registeredEmail ? (
          <div className="auth-form">
            <div style={{ display: 'inline-flex', padding: '0.75rem', background: '#ecfdf5', borderRadius: '50%', color: '#059669', marginBottom: '1rem' }}>
              <Mail size={32} />
            </div>
            <h2>Verify your email</h2>
            <p>
              We sent a verification link to <strong>{registeredEmail}</strong>. If using console mail mode during local development, check the terminal output for the token link.
            </p>
            <div style={{ marginTop: '1.5rem' }}>
              <Link href="/login" className="button">
                Back to Sign in
              </Link>
            </div>
          </div>
        ) : challengeToken ? (
          <form className="auth-form" onSubmit={submit2FA}>
            <div style={{ display: 'inline-flex', padding: '0.75rem', background: '#eff6ff', borderRadius: '50%', color: '#2563eb', marginBottom: '1rem' }}>
              <KeyRound size={32} />
            </div>
            <h2>Two-factor challenge</h2>
            <p>Enter the 6-digit TOTP code from your authenticator app, or use an 8-character emergency recovery code.</p>

            <div className="field">
              <label htmlFor="2fa-code">Authentication or recovery code</label>
              <input
                id="2fa-code"
                type="text"
                autoComplete="one-time-code"
                required
                autoFocus
                placeholder="123456 or a1b2c3d4"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.trim())}
              />
            </div>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button className="button" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify & Continue'} <ArrowRight size={15} />
            </button>

            <div className="auth-switch" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => {
                  setChallengeToken('');
                  setTwoFactorCode('');
                  setError('');
                }}
              >
                Cancel and back to login
              </button>
            </div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>{mode === 'login' ? 'Sign in to your SecureShare workspace.' : 'Start sharing files with authenticated encryption.'}</p>

            {/* Quick Demo Login Option */}
            <div style={{ marginBottom: 20 }}>
              <button
                type="button"
                onClick={demoLogin}
                disabled={busy}
                className="btn-demo"
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
              >
                <Sparkles size={16} /> Instant Demo Sign-in (1-Click)
              </button>
              <div style={{ textAlign: 'center', margin: '14px 0 4px', color: '#94a3b8', fontSize: 11 }}>
                ─── OR CONTINUE WITH CREDENTIALS ───
              </div>
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} placeholder="Your full name" />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 12 : 1}
                maxLength={128}
                placeholder={mode === 'register' ? 'At least 12 characters' : 'Your password'}
              />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                />
              </div>
            )}

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button className="button" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={15} />
            </button>

            {mode === 'login' && (
              <div className="auth-switch">
                <Link href="/forgot-password">Forgot password?</Link>
              </div>
            )}

            <div className="auth-switch">
              {mode === 'login' ? (
                <>New to SecureShare? <Link href="/register">Create an account</Link></>
              ) : (
                <>Already have an account? <Link href="/login">Sign in</Link></>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
