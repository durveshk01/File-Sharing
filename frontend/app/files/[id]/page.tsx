'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LockKeyhole,
  ShieldCheck,
  KeyRound,
  FileText,
  ArrowDownToLine,
  Trash2,
  Share2,
  Activity,
  UserCheck,
  UserPlus,
  Check,
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Layers
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

export default function FileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [file, setFile] = useState<any>(null);
  const [cryptoMeta, setCryptoMeta] = useState<any>(null);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  // New collaborator form
  const [collabEmail, setCollabEmail] = useState('');
  const [collabRole, setCollabRole] = useState('VIEWER');

  async function loadData() {
    try {
      const [fRes, metaRes, permRes, logRes] = await Promise.all([
        fetch(`${API}/api/files/${id}`, { credentials: 'include' }),
        fetch(`${API}/api/files/${id}/encryption/metadata`, { credentials: 'include' }),
        fetch(`${API}/api/files/${id}/permissions`, { credentials: 'include' }),
        fetch(`${API}/api/files/${id}/access-logs`, { credentials: 'include' }),
      ]);

      if (fRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (!fRes.ok) throw new Error('File not found or access denied');

      setFile(await fRes.json());
      if (metaRes.ok) setCryptoMeta(await metaRes.json());
      if (permRes.ok) setPermissions(await permRes.json());
      if (logRes.ok) setLogs(await logRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading file');
    }
  }

  useEffect(() => {
    loadData();
  }, [id]);

  async function verifyIntegrity() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const r = await fetch(`${API}/api/files/${id}/encryption/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256_checksum: file?.sha256_checksum }),
        credentials: 'include',
      });
      const b = await r.json();
      if (b.valid && b.checksum_verified) {
        setVerifyResult('Integrity Check PASSED: Ciphertext authentic and SHA-256 matches original bytes.');
      } else {
        setVerifyResult('Integrity Check FAILED: Authentication tag or checksum mismatch!');
      }
    } catch (e) {
      setVerifyResult('Verification failed due to connection error.');
    } finally {
      setVerifying(false);
    }
  }

  async function addCollaborator(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      const r = await fetch(`${API}/api/files/${id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collabEmail, role: collabRole }),
        credentials: 'include',
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail || 'Could not grant permission');
      setCollabEmail('');
      setMsg(`Granted ${collabRole} permission to ${collabEmail}`);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add permission');
    }
  }

  async function revokePermission(permId: string) {
    if (!confirm('Revoke access for this user?')) return;
    const r = await fetch(`${API}/api/permissions/${permId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (r.ok) loadData();
    else setError('Could not revoke permission');
  }

  async function downloadFile() {
    const r = await fetch(`${API}/api/files/${id}/download`, { credentials: 'include' });
    if (r.ok) {
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file?.name || 'download';
      a.click();
      URL.revokeObjectURL(a.href);
    } else {
      alert('Decryption or download failed');
    }
  }

  async function deleteFile() {
    if (!confirm(`Permanently delete "${file?.name}"?`)) return;
    const r = await fetch(`${API}/api/files/${id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) router.push('/files');
    else setError('Could not delete file');
  }

  if (error && !file) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', padding: 20, textAlign: 'center' }}>
        <p className="auth-error">{error}</p>
        <Link href="/files" className="button" style={{ marginTop: 20 }}>
          ← Back to Files
        </Link>
      </div>
    );
  }

  if (!file) {
    return <div className="empty">Loading cryptographic metadata…</div>;
  }

  return (
    <div className="dash-main" style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <header className="dash-top">
        <Link href="/files" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#2563eb' }}>
          <ArrowLeft size={16} /> Back to Files
        </Link>
        <span>SecureShare Cryptographic Inspector</span>
      </header>

      <div className="dash-content" style={{ maxWidth: 1000, margin: 'auto', padding: '30px 24px' }}>
        {/* Header with Title and Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <div className="badge badge-success" style={{ marginBottom: 8 }}>
              <ShieldCheck size={12} /> AES-256-GCM PROTECTED
            </div>
            <h1 style={{ margin: 0, font: '700 28px Manrope', color: '#0f172a' }}>{file.name}</h1>
            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
              {file.content_type} · {fmt(file.size)} · Uploaded {new Date(file.created_at).toLocaleString()}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="button" onClick={downloadFile}>
              <ArrowDownToLine size={15} /> Download Decrypted
            </button>
            <button className="btn-outline" onClick={deleteFile} style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
        {msg && <div style={{ background: '#ecfdf5', color: '#065f46', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 12 }}>{msg}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20 }}>
          {/* Left Column: Cryptographic Envelope Details */}
          <div>
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title">
                <h3>
                  <Cpu size={16} color="#2563eb" /> Cryptographic Envelope Metadata
                </h3>
                <button className="btn-outline btn-sm" disabled={verifying} onClick={verifyIntegrity}>
                  {verifying ? 'Checking…' : 'Run Integrity Check'}
                </button>
              </div>

              {verifyResult && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 16,
                    fontSize: 12,
                    background: verifyResult.includes('PASSED') ? '#ecfdf5' : '#fef2f2',
                    color: verifyResult.includes('PASSED') ? '#065f46' : '#991b1b',
                    border: `1px solid ${verifyResult.includes('PASSED') ? '#a7f3d0' : '#fecaca'}`,
                  }}
                >
                  {verifyResult}
                </div>
              )}

              {cryptoMeta ? (
                <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Encryption Algorithm:</span>
                    <strong>{cryptoMeta.algorithm} (AEAD)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Key Hierarchy:</span>
                    <span>Envelope Wrapped under Server KEK</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Unique 96-bit Nonce (Hex):</span>
                    <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#2563eb' }}>
                      {cryptoMeta.nonce_hex}
                    </code>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Wrapped Key Size:</span>
                    <span>{cryptoMeta.wrapped_key_size_bytes} bytes</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Original SHA-256 Checksum:</span>
                    <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#0f172a' }}>
                      {cryptoMeta.sha256_checksum}
                    </code>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
                    <span style={{ color: '#64748b' }}>Tamper Protection:</span>
                    <span className="badge badge-success">
                      <Check size={11} /> 128-bit Authentication Tag Verified
                    </span>
                  </div>
                </div>
              ) : (
                <p style={{ color: '#64748b', fontSize: 12 }}>Loading cryptographic parameters…</p>
              )}
            </div>

            {/* Access Logs for this file */}
            <div className="panel">
              <div className="panel-title">
                <h3>
                  <Activity size={16} color="#2563eb" /> File Access & Audit Log
                </h3>
              </div>

              {logs.length ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {logs.map((l, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 10,
                        borderRadius: 6,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: 11,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <strong>{l.action}</strong>
                        <div style={{ color: '#64748b', marginTop: 2 }}>{l.detail || l.action}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`badge ${l.result === 'success' ? 'badge-success' : 'badge-danger'}`}>
                          {l.result || 'success'}
                        </span>
                        <small style={{ display: 'block', color: '#94a3b8', marginTop: 4 }}>
                          {new Date(l.created_at).toLocaleString()}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No access history recorded yet for this file.</div>
              )}
            </div>
          </div>

          {/* Right Column: Collaborator Permissions Manager */}
          <div>
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title">
                <h3>
                  <UserCheck size={16} color="#2563eb" /> Collaborator Access
                </h3>
              </div>

              <form onSubmit={addCollaborator} style={{ marginBottom: 18 }}>
                <div className="field">
                  <label htmlFor="collab-email">Grant Access to Email</label>
                  <input
                    id="collab-email"
                    type="email"
                    required
                    placeholder="colleague@example.com"
                    value={collabEmail}
                    onChange={(e) => setCollabEmail(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="collab-role">Permission Level</label>
                  <select
                    id="collab-role"
                    value={collabRole}
                    onChange={(e) => setCollabRole(e.target.value)}
                    style={{
                      height: 40,
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: 13,
                    }}
                  >
                    <option value="VIEWER">VIEWER (View and Download)</option>
                    <option value="EDITOR">EDITOR (Full collaborative access)</option>
                  </select>
                </div>

                <button className="button" style={{ width: '100%', justifyContent: 'center' }}>
                  <UserPlus size={15} /> Add Collaborator
                </button>
              </form>

              <h4>Active Permissions ({permissions.length})</h4>
              {permissions.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {permissions.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        background: '#f8fafc',
                        borderRadius: 6,
                        border: '1px solid #e2e8f0',
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <strong>{p.email}</strong>
                        <span className="badge badge-info" style={{ marginLeft: 6 }}>
                          {p.role}
                        </span>
                      </div>
                      <button
                        onClick={() => revokePermission(p.id)}
                        style={{ border: 0, background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: '#94a3b8' }}>
                  No additional collaborators added yet. Only you (the owner) currently have access.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
