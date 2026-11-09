'use client';

import { API } from '../api';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';



export default function ResetPage() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    setBusy(true);

    try {
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) throw new Error('This password reset link is invalid or incomplete.');

      const password = new FormData(event.currentTarget).get('password');
      const response = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Could not reset the password. Try again.');

      setMessage('Password updated. Redirecting to sign in…');
      window.setTimeout(() => router.replace('/login'), 1000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not reset the password. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-form-side">
      <form className="auth-form" onSubmit={submit} aria-labelledby="reset-title">
        <h2 id="reset-title">Choose a new password</h2>
        <p>Use at least 12 characters for your new password.</p>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p role="status" aria-live="polite">{message}</p>}
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Updating…' : 'Reset password'}
        </button>
        <div className="auth-switch"><Link href="/login">Back to sign in</Link></div>
      </form>
    </main>
  );
}
