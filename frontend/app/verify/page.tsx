'use client';

import { apiRequest } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';



export default function VerifyPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Verifying your email…');
  const verification = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setMessage('Verification link is invalid.');
      return;
    }
    // Reuse the in-flight request during Strict Mode effect replay: a one-time
    // verification token must not be consumed by two requests from this page.
    verification.current ??= apiRequest('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    verification.current.then(() => {
        if (!active) return;
        setMessage('Email verified. Opening your workspace…');
        timer = setTimeout(() => router.replace('/dashboard'), 700);
      })
      .catch((e) => { if (active) setMessage(e.message); });
    return () => { active = false; if (timer) clearTimeout(timer); };
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
