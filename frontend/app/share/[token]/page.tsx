'use client';

import { API } from '../../api';

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
  FileDown,
  RefreshCw,
  Sparkles,
  Zap
} from 'lucide-react';
import { downloadAndDecryptSharedFile } from '../../lib/downloader';



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
    encryption_version?: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [grant, setGrant] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [keyFromHash, setKeyFromHash] = useState<string>('');

  useEffect(() => {
    // Extract zero-knowledge key fragment from URL hash
    if (typeof window !== 'undefined' && window.location.hash) {
      const key = new URLSearchParams(window.location.hash.slice(1)).get('key');
      if (key) setKeyFromHash(key.replace(/ /g, '+'));
    }

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

  async function verifyPassword() {
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
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError('');
    setDownloadProgress(10);
    setDownloadStatus('Authorizing secure transfer...');

    try {
      if (file?.encryption_version === 'v2' && !keyFromHash.trim()) throw new Error('Ask the sender for the complete link or paste the file decryption key below.');
      await downloadAndDecryptSharedFile(token, file?.encryption_version === 'v2' ? keyFromHash : null, grant, (pct, status) => {
        setDownloadProgress(pct);
        setDownloadStatus(status);
      });

      setDownloadComplete(true);
      setDownloadStatus('Decryption & Integrity Verified (SHA-256)');
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 0%, #172554 0%, #0b0f19 80%)',
        display: 'grid',
        placeItems: 'center',
        padding: '30px 16px',
        color: '#f8fafc',
      }}
    >
      <div style={{ width: 'min(100%, 480px)' }}>
        {/* Header Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', display: 'grid', placeItems: 'center', boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)' }}>
              <LockKeyhole size={20} />
            </div>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em' }}>SecureShare</span>
          </Link>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
            End-to-End Encrypted Document Delivery
          </div>
        </div>

        {/* Card */}
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 32, boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px' }} />
              <div>Verifying cryptographic share token...</div>
            </div>
          ) : error && !file ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
                <AlertCircle size={24} />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>Access Unavailable</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px' }}>{error}</p>
              <Link href="/" className="btn-secondary btn-sm">
                Return to SecureShare
              </Link>
            </div>
          ) : file ? (
            <div>
              {error && <div className="notice-error" role="alert">{error}</div>}
              {file.encryption_version === 'v2' && !downloadComplete && (
                <div className="field">
                  <label htmlFor="share-key">File decryption key (from the sender’s full link)</label>
                  <input id="share-key" type="password" autoComplete="off" value={keyFromHash} onChange={(e) => setKeyFromHash(e.target.value)} placeholder="Paste the Base64 file key if the link is incomplete" />
                </div>
              )}
              {/* File details */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#1f2937', padding: 18, borderRadius: 12, border: '1px solid #374151', marginBottom: 20 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: '#111827', display: 'grid', placeItems: 'center', color: '#60a5fa' }}>
                  <FileText size={22} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    {fmt(file.size)} • {file.content_type || 'Encrypted File'}
                  </div>
                </div>
              </div>

              {/* Security info badges */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', background: '#1f2937', padding: '8px 12px', borderRadius: 6 }}>
                  <span>Cipher</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>AES-256-GCM (128-bit Tag)</span>
                </div>
                {keyFromHash && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', background: '#1f2937', padding: '8px 12px', borderRadius: 6 }}>
                      <span>Decryption Mode</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{file.encryption_version === 'v2' ? 'On this device' : 'Legacy server envelope'}</span>
                  </div>
                )}
                {file.max_downloads && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', background: '#1f2937', padding: '8px 12px', borderRadius: 6 }}>
                    <span>Download Limit</span>
                    <span>{file.downloads || 0} / {file.max_downloads} used</span>
                  </div>
                )}
              </div>

              {/* Password Challenge (if required and not granted) */}
              {file.password_required && !grant ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KeyRound size={15} /> This file is protected with an Argon2id password.
                  </div>
                  <input
                    type="password"
                    placeholder="Enter the share access password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: '100%', height: 42, background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#fff', padding: '0 12px', fontSize: 14 }}
                  />
                  <button onClick={verifyPassword} disabled={verifying || !password} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    {verifying ? 'Verifying Password...' : 'Unlock File'}
                  </button>
                </div>
              ) : downloadComplete ? (
                <div style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', padding: 20, borderRadius: 10, color: '#34d399' }}>
                  <CheckCircle2 size={32} style={{ margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Decryption Complete!</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    File verified against SHA-256 integrity tag and saved to your device.
                  </div>
                </div>
              ) : (
                <div>
                  {downloading && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                        <span>{downloadStatus}</span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div className="progress-track" style={{ height: 5 }}>
                        <div className="progress-fill" style={{ width: `${downloadProgress}%` }} />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="btn-primary"
                    style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 15 }}
                  >
                    {downloading ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" /> Decrypting Locally...
                      </>
                    ) : (
                      <>
                        <ArrowDownToLine size={16} /> Decrypt & Download File
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#64748b' }}>
          Protected by SecureShare Authenticated Cryptography
        </div>
      </div>
    </div>
  );
}
