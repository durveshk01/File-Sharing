'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function VerifyPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setMessage('Verification link is invalid.');
      return;
    }
    fetch(`${API}/api/auth/verify-email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail || 'This verification link is invalid or expired.');
        }
        setMessage('Email verified. Opening your workspace…');
        setTimeout(() => router.replace('/dashboard'), 700);
      })
      .catch((e) => setMessage(e.message));
  }, [router]);

  return (
    <main className="auth-form-side">
      <section className="auth-form">
        <h2>Email verification</h2>
        <p>{message}</p>
        <a href="/login">Sign in</a>
      </section>
    </main>
  );
}
