'use client';

import { API } from '../../api';
import WorkspaceShell from '../../components/workspace-shell';
import { apiRequest, requireBrowserAccount } from '../../lib/api';
import { downloadAndDecryptFile, readDecryptedFile } from '../../lib/downloader';
import { getLocalFileKey, saveLocalFileKey, validateFileKey } from '../../lib/keyVault';

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
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState('');
  const [newName, setNewName] = useState('');

  // New collaborator form
  const [collabEmail, setCollabEmail] = useState('');
  const [collabRole, setCollabRole] = useState('VIEWER');

  async function loadData() {
    setError('');
    try {
      await requireBrowserAccount();
      const loaded = await apiRequest(`/api/files/${id}`);
      setFile(loaded); setNewName(loaded.name);
      setCryptoMeta(await apiRequest(`/api/files/${id}/encryption/metadata`));
      if (loaded.access_role === 'OWNER') {
        const [permissions, logs] = await Promise.all([apiRequest(`/api/files/${id}/permissions`), apiRequest(`/api/files/${id}/access-logs`)]);
        setPermissions(permissions); setLogs(logs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading file');
    }
  }

  useEffect(() => {
    setFile(null); setPermissions([]); setLogs([]); setKeyInput(''); setVerifyResult(null);
    loadData();
  }, [id]);

  async function verifyIntegrity() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (file.encryption_version === 'v2' && !await getLocalFileKey(id)) {
        const result = await apiRequest(`/api/files/${id}/encryption/metadata`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (!result.ciphertext_verified) throw new Error('Stored ciphertext failed its size or checksum check');
        setVerifyResult('Ciphertext checksum verified. Import the file key to verify AES-GCM authentication and original plaintext on this device.');
        return;
      }
      await readDecryptedFile(id);
      setVerifyResult(file.encryption_version === 'v2'
        ? 'Integrity Check PASSED: Device decryption authenticated the AES-GCM tag and both ciphertext and plaintext SHA-256 checksums.'
        : 'Integrity Check PASSED: Legacy server envelope decryption and browser plaintext checksum verified.');
    } catch (e) {
      setVerifyResult(`Integrity Check FAILED: ${e instanceof Error ? e.message : 'Verification failed'}`);
    } finally {
      setVerifying(false);
    }
  }

  async function addCollaborator(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      await apiRequest(`/api/files/${id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collabEmail, role: collabRole }),
      });
      setCollabEmail('');
      setMsg(`Granted ${collabRole} permission to ${collabEmail}`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add permission');
    }
  }

  async function revokePermission(permId: string) {
    if (!confirm('Revoke access for this user?')) return;
    try { await apiRequest(`/api/permissions/${permId}`, { method: 'DELETE' }); await loadData(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not revoke permission'); }
  }

  async function downloadFile() {
    setBusy('download'); setError('');
    try { await downloadAndDecryptFile(id, (_, status) => setMsg(status)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Download failed'); }
    finally { setBusy(''); }
  }

  async function deleteFile() {
    if (!confirm(`Move "${file?.name}" to trash?`)) return;
    setBusy('trash');
    try { await apiRequest(`/api/files/${id}/trash`, { method: 'POST' }); router.push('/files/manage?view=trash'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not move file to trash'); }
    finally { setBusy(''); }
  }

  async function importKey(e: FormEvent) {
    e.preventDefault(); setBusy('key'); setError(''); setMsg('');
    try {
      const key = validateFileKey(keyInput);
      await readDecryptedFile(id, (_, status) => setMsg(status), key);
      await saveLocalFileKey(id, key, true);
      setKeyInput(''); setMsg('Private key imported after successful device decryption and checksum verification.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Key import failed'); }
    finally { setBusy(''); }
  }

  async function exportKey() {
    setError('');
    try {
      const key = await getLocalFileKey(id);
      if (!key) throw new Error('No key is saved on this device. Restore your key backup first.');
      await navigator.clipboard.writeText(key); setMsg('Private file key copied. Give it only to the intended recipient.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not copy the file key'); }
  }

  async function rename(e: FormEvent) {
    e.preventDefault(); setBusy('rename'); setError('');
    try {
      await apiRequest(`/api/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, version: file.version }) });
      await loadData(); setMsg('File renamed.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Rename failed'); }
    finally { setBusy(''); }
  }

  if (error && !file) {
    return (
      <WorkspaceShell title="File details"><div className="empty">
        <p className="auth-error">{error}</p>
        <Link href="/files" className="button" style={{ marginTop: 20 }}>
          ← Back to Files
        </Link>
      </div></WorkspaceShell>
    );
  }

  if (!file) {
    return <WorkspaceShell title="File details"><div className="empty" role="status">Loading file details…</div></WorkspaceShell>;
  }

  return (
    <WorkspaceShell title="File details">
      <header className="dash-top">
        <Link href="/files" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#2563eb' }}>
          <ArrowLeft size={16} /> Back to Files
        </Link>
        <span>SecureShare Cryptographic Inspector</span>
      </header>

      <div style={{ maxWidth: 1000, margin: 'auto' }}>
        {/* Header with Title and Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <div className="badge badge-success" style={{ marginBottom: 8 }}>
              <ShieldCheck size={12} /> AES-256-GCM PROTECTED
            </div>
            <h1 style={{ margin: 0, font: '700 28px Manrope', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{file.name}</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              {file.content_type} · {fmt(file.size)} · Uploaded {new Date(file.created_at).toLocaleString()}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="button" disabled={!!busy} onClick={downloadFile}>
              <ArrowDownToLine size={15} /> Download Decrypted
            </button>
            {file.access_role === 'OWNER' && <button className="btn-outline" disabled={!!busy} onClick={deleteFile} style={{ color: '#fda4af' }}><Trash2 size={15} />Move to trash</button>}
          </div>
        </div>

        {error && <div className="auth-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
        {msg && <div className="notice-success" role="status">{msg}</div>}

        <div className="detail-grid">
          {/* Left Column: Cryptographic Envelope Details */}
          <div>
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title">
                <h3>
                  <Cpu size={16} color="#2563eb" /> Cryptographic Envelope Metadata
                </h3>
                <button className="btn-outline btn-sm" disabled={verifying || !!busy} onClick={verifyIntegrity}>
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
                    background: verifyResult.includes('FAILED') ? 'var(--rose-subtle)' : verifyResult.includes('PASSED') ? 'var(--emerald-subtle)' : 'var(--primary-subtle)',
                    color: verifyResult.includes('FAILED') ? '#fecdd3' : 'var(--text-primary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {verifyResult}
                </div>
              )}

              {cryptoMeta ? (
                <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
                  <div className="metadata-row">
                    <span>Encryption Algorithm:</span>
                    <strong>{cryptoMeta.algorithm} (AEAD)</strong>
                  </div>
                  <div className="metadata-row">
                    <span>Key Hierarchy:</span>
                    <span>{cryptoMeta.key_wrapping_scheme}</span>
                  </div>
                  <div className="metadata-row">
                    <span>Unique 96-bit Nonce (Hex):</span>
                    <code style={{ background: 'var(--surface-raised)', padding: '2px 6px', borderRadius: 4, color: '#93c5fd' }}>
                      {cryptoMeta.nonce_hex}
                    </code>
                  </div>
                  <div className="metadata-row">
                    <span>Wrapped Key Size:</span>
                    <span>{cryptoMeta.wrapped_key_size_bytes} bytes</span>
                  </div>
                  <div className="metadata-row">
                    <span>Original SHA-256 Checksum:</span>
                    <code style={{ background: 'var(--surface-raised)', padding: '2px 6px', borderRadius: 4, color: 'var(--text-primary)' }}>
                      {cryptoMeta.sha256_checksum}
                    </code>
                  </div>
                  <div className="metadata-row">
                    <span>Tamper Protection:</span>
                    <span className="badge badge-success">
                      <ShieldCheck size={11} />Checked during decryption
                    </span>
                  </div>
                </div>
              ) : (
                <p style={{ color: '#64748b', fontSize: 12 }}>Loading cryptographic parameters…</p>
              )}
            </div>

            {file.encryption_version === 'v2' && <section className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title"><h3><KeyRound size={16} />Device-held private key</h3><button className="btn-secondary btn-sm" disabled={!!busy} onClick={exportKey}>Copy private file key</button></div>
              <p style={{ color: 'var(--text-secondary)' }}>Import the key from the file owner or another device. It is verified locally before being saved and is never uploaded to the API.</p>
              <form onSubmit={importKey}><div className="field"><label htmlFor="file-key">Base64 file decryption key</label><input id="file-key" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} required placeholder="Paste the private file key" /></div>
                <button className="btn-primary" disabled={!!busy}>{busy === 'key' ? 'Verifying key…' : 'Verify & import key'}</button></form>
            </section>}
            {file.access_role !== 'VIEWER' && <section className="panel" style={{ marginBottom: 20 }}><h3>Rename file</h3><form onSubmit={rename} className="toolbar" style={{ marginTop: 14 }}><input aria-label="New file name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={255} required /><button className="btn-primary" disabled={!!busy}>Save name</button></form></section>}

            {/* Access logs are private to the file owner. */}
            {file.access_role === 'OWNER' && <div className="panel">
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
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
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
            </div>}
          </div>

          {/* Right Column: Collaborator Permissions Manager */}
          <div>
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title">
                <h3>
                  <UserCheck size={16} color="#2563eb" /> Collaborator Access
                </h3>
              </div>

              {file.access_role === 'OWNER' ? <form onSubmit={addCollaborator} style={{ marginBottom: 18 }}>
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
                    <option value="EDITOR">EDITOR (Read, download and rename)</option>
                  </select>
                </div>

                <button className="button" style={{ width: '100%', justifyContent: 'center' }}>
                  <UserPlus size={15} /> Add Collaborator
                </button>
              </form> : <p style={{ color: 'var(--text-secondary)' }}>Your permission is {file.access_role}. Only the owner can change collaborators, create public links, or manage trash.</p>}
              {file.encryption_version === 'v2' && <p style={{ color: 'var(--text-secondary)' }}>Metadata access does not transfer the private key. Give authorized collaborators the file key separately.</p>}

              {file.access_role === 'OWNER' && <h4>Active Permissions ({permissions.length})</h4>}
              {file.access_role === 'OWNER' && (permissions.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {permissions.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        background: 'var(--surface-raised)',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
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
              ))}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
