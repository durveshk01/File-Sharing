'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowDownToLine,
  LockKeyhole,
  ShieldCheck,
  KeyRound,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileDown
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

export default function SharedFile() {
  const { token } = useParams<{ token: string }>();
  const [file, setFile] = useState<{
    name: string;
    size: number;
    content_type?: string;
    sha256_checksum?: string;
    expires_at?: string | null;
    max_downloads?: number | null;
    downloads?: number;
    password_required?: boolean;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [grant, setGrant] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadComplete, setDownloadComplete] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/shares/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error('This sharing link is unavailable. It may have expired, reached its download limit, or been revoked by the owner.');
        }
        setFile(await r.json());
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function verify() {
    setVerifying(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/shares/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const b = await r.json();
      if (!r.ok) {
        throw new Error(b.detail || 'Password verification failed');
      }
      setGrant(b.grant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function download() {
    setDownloading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/shares/${token}/download`, {
        method: 'POST',
        headers: grant ? { 'X-Share-Grant': grant } : {},
      });
      if (!r.ok) {
        const body = await r.json();
        throw new Error(body.detail || 'This share link is no longer available.');
      }
      const b = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = file?.name || 'download';
      a.click();
      URL.revokeObjectURL(a.href);
      setDownloadComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 0%, #1e293b 0%, #0f172a 100%)',
        display: 'grid',
        placeItems: 'center',
        padding: '30px 16px',
        color: '#f8fafc',
      }}
    >
      <div
        style={{
          width: 'min(100%, 460px)',
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Link href="/" className="brand" style={{ color: '#fff' }}>
            <span className="brand-mark" style={{ background: '#2563eb', color: '#fff' }}>
              <LockKeyhole size={17} />
            </span>
            SecureShare
          </Link>
          <span className="badge badge-success" style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)' }}>
            <ShieldCheck size={12} /> AES-256-GCM
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
            <LockKeyhole size={32} style={{ margin: 'auto', marginBottom: 12, opacity: 0.6 }} />
            <p>Validating cryptographic sharing token…</p>
          </div>
        ) : error && !file ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#451a1a', color: '#f87171', display: 'grid', placeItems: 'center', margin: 'auto', marginBottom: 16 }}>
              <AlertCircle size={24} />
            </div>
            <h2 style={{ font: '700 20px Manrope', margin: '0 0 10px', color: '#fff' }}>Link Unavailable</h2>
            <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>{error}</p>
            <div style={{ marginTop: 24 }}>
              <Link href="/" className="button" style={{ background: '#334155', color: '#fff' }}>
                Go to SecureShare Home
              </Link>
            </div>
          </div>
        ) : file ? (
          <div>
            <div style={{ textAlign: 'center', paddingBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(37,99,235,0.2)', color: '#60a5fa', display: 'grid', placeItems: 'center', margin: 'auto', marginBottom: 14 }}>
                <FileText size={26} />
              </div>
              <h2 style={{ font: '700 22px Manrope', margin: '0 0 6px', color: '#fff', wordBreak: 'break-all' }}>
                {file.name}
              </h2>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>
                {fmt(file.size)} · {file.content_type || 'Protected Document'}
              </div>
            </div>

            {/* Security Parameters Metadata */}
            <div style={{ display: 'grid', gap: 10, margin: '20px 0', fontSize: 12 }}>
              {file.expires_at && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={13} /> Expiration:
                  </span>
                  <span style={{ color: '#f1f5f9' }}>{new Date(file.expires_at).toLocaleString()}</span>
                </div>
              )}

              {file.max_downloads && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileDown size={13} /> Downloads Remaining:
                  </span>
                  <span style={{ color: '#38bdf8' }}>
                    {Math.max(0, file.max_downloads - (file.downloads || 0))} of {file.max_downloads}
                  </span>
                </div>
              )}

              {file.sha256_checksum && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Integrity Checksum:</span>
                  <code style={{ color: '#a78bfa', fontSize: 10 }}>{file.sha256_checksum.slice(0, 16)}…</code>
                </div>
              )}
            </div>

            {error && (
              <div className="auth-error" style={{ marginBottom: 16 }}>
                {error}
              </div>
            )}

            {downloadComplete ? (
              <div style={{ padding: 16, background: 'rgba(16,185,129,0.15)', borderRadius: 10, textAlign: 'center', border: '1px solid rgba(16,185,129,0.3)', marginTop: 10 }}>
                <CheckCircle2 size={24} color="#34d399" style={{ margin: 'auto', marginBottom: 8 }} />
                <h4 style={{ margin: '0 0 4px', color: '#fff' }}>Decryption & Download Complete</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                  File integrity verified against 128-bit authentication tag.
                </p>
              </div>
            ) : file.password_required && !grant ? (
              <div style={{ marginTop: 20 }}>
                <div className="field">
                  <label htmlFor="share-password" style={{ color: '#cbd5e1' }}>
                    Password Required
                  </label>
                  <input
                    id="share-password"
                    type="password"
                    placeholder="Enter link password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff' }}
                  />
                </div>
                <button
                  className="button"
                  onClick={verify}
                  disabled={verifying}
                  style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                >
                  <KeyRound size={15} />
                  {verifying ? 'Verifying with Argon2id…' : 'Unlock File'}
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                <button
                  className="button"
                  onClick={download}
                  disabled={downloading}
                  style={{ width: '100%', justifyContent: 'center', background: '#2563eb' }}
                >
                  <ArrowDownToLine size={16} />
                  {downloading ? 'Decrypting & streaming…' : 'Download Verified File'}
                </button>
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
              Protected by SecureShare. AES-256-GCM authenticated encryption guarantees content authenticity.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
