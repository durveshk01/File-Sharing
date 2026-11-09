'use client';

import { API } from '../api';

import { FormEvent, useState } from 'react';
import Link from 'next/link';



export default function ForgotPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    setBusy(true);

    try {
      const email = new FormData(event.currentTarget).get('email');
      const response = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Could not submit the request. Try again.');
      setMessage(body.message || 'If that email has an account, reset instructions will be sent.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not submit the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-form-side">
      <form className="auth-form" onSubmit={submit} aria-labelledby="forgot-title">
        <h2 id="forgot-title">Reset your password</h2>
        <p>We’ll send reset instructions if that email has an account.</p>
        <div className="field">
          <label htmlFor="forgot-email">Email address</label>
          <input id="forgot-email" name="email" type="email" autoComplete="email" required />
        </div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p role="status" aria-live="polite">{message}</p>}
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send instructions'}
        </button>
        <div className="auth-switch"><Link href="/login">Back to sign in</Link></div>
      </form>
    </main>
  );
}
