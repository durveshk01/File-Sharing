'use client';

import { ChangeEvent, DragEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  File,
  Files,
  FolderOpen,
  Gauge,
  Link2,
  LockKeyhole,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Share2,
  Trash2,
  UploadCloud,
  Copy,
  Check,
  Eye,
  KeyRound,
  Clock,
  Search,
  X,
  FileText,
  FileCode,
  FileArchive,
  Image as ImageIcon
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type F = {
  id: string;
  name: string;
  size: number;
  content_type: string;
  sha256_checksum?: string;
  created_at: string;
};

type D = {
  stats: {
    files: number;
    shared_files: number;
    active_links: number;
    downloads: number;
    storage_bytes: number;
  };
  files: F[];
  activity: {
    action: string;
    detail: string;
    created_at: string;
  }[];
};

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return <ImageIcon size={15} />;
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext || '')) return <FileArchive size={15} />;
  if (['js', 'ts', 'py', 'json', 'html', 'css'].includes(ext || '')) return <FileCode size={15} />;
  return <FileText size={15} />;
}

export default function Dashboard() {
  const [data, setData] = useState<D | null>(null);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const router = useRouter();

  // Share Modal State
  const [shareFile, setShareFile] = useState<F | null>(null);
  const [expiresHours, setExpiresHours] = useState('24');
  const [maxDownloads, setMaxDownloads] = useState('10');
  const [sharePassword, setSharePassword] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  async function load() {
    const [u, d] = await Promise.all([
      fetch(`${API}/api/auth/me`, { credentials: 'include' }),
      fetch(`${API}/api/dashboard`, { credentials: 'include' }),
    ]);
    if (u.status === 401) {
      router.replace('/login');
      return;
    }
    if (!d.ok) {
      setError('Could not load dashboard data');
      return;
    }
    setUser(await u.json());
    setData(await d.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleFilesUpload(fileList: File[]) {
    if (!fileList.length) return;
    setBusy(true);
    setError('');
    try {
      for (const f of fileList) {
        const body = new FormData();
        body.append('file', f);
        const r = await fetch(`${API}/api/files`, {
          method: 'POST',
          body,
          credentials: 'include',
        });
        if (!r.ok) {
          const b = await r.json();
          throw new Error(b.detail || `Could not upload ${f.name}`);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    await handleFilesUpload(files);
    e.target.value = '';
  }

  function handleDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesUpload(Array.from(e.dataTransfer.files));
    }
  }

  async function createShareLink() {
    if (!shareFile) return;
    setShareBusy(true);
    setError('');
    try {
      const payload: Record<string, any> = {};
      if (expiresHours !== 'unlimited') {
        payload.expires_in_hours = parseInt(expiresHours, 10);
      }
      if (maxDownloads !== 'unlimited') {
        payload.max_downloads = parseInt(maxDownloads, 10);
      }
      if (sharePassword.trim()) {
        payload.password = sharePassword.trim();
      }

      const r = await fetch(`${API}/api/files/${shareFile.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail || 'Could not generate share link');
      setGeneratedLink(b.url);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating share link');
    } finally {
      setShareBusy(false);
    }
  }

  async function copyToClipboard() {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function remove(f: F) {
    if (!confirm(`Permanently delete "${f.name}"? This will also revoke any active sharing links.`)) return;
    const r = await fetch(`${API}/api/files/${f.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (r.ok) load();
    else setError('Could not delete file');
  }

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  if (!data) return <div className="empty">{error || 'Loading your secure workspace…'}</div>;

  const filteredFiles = data.files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const stats = [
    ['Stored Files', data.stats.files, Files],
    ['Shared Files', data.stats.shared_files, Share2],
    ['Active Links', data.stats.active_links, Link2],
    ['Downloads', data.stats.downloads, ArrowDownToLine],
  ] as const;

  const storageQuota = 50 * 1024 * 1024; // 50MB default
  const usedPercent = Math.min(100, Math.round((data.stats.storage_bytes / storageQuota) * 100));

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <LockKeyhole size={17} />
          </span>
          SecureShare
        </Link>

        <div className="side-label">WORKSPACE</div>
        <Link className="side-item active" href="/dashboard">
          <Gauge size={16} />
          Overview
        </Link>
        <Link className="side-item" href="/files">
          <Files size={16} />
          All Files
        </Link>
        <Link className="side-item" href="/shared">
          <Share2 size={16} />
          Sharing Links
        </Link>
        <Link className="side-item" href="/access-logs">
          <Activity size={16} />
          Audit Logs
        </Link>
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} />
          Notifications
        </Link>

        <div className="side-label">SECURITY & PREFERENCES</div>
        <Link className="side-item" href="/security">
          <KeyRound size={16} />
          Security & 2FA
        </Link>
        <Link className="side-item" href="/settings">
          <Settings size={16} />
          Settings
        </Link>

        <div className="sidebar-bottom">
          <div style={{ padding: '0 10px 12px', fontSize: 11, color: '#94a3b8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Storage Used</span>
              <span>{fmt(data.stats.storage_bytes)}</span>
            </div>
            <div style={{ background: '#334155', borderRadius: 4, height: 4, overflow: 'hidden' }}>
              <div style={{ background: '#38bdf8', height: '100%', width: `${usedPercent}%` }}></div>
            </div>
          </div>
          <button
            className="side-item"
            onClick={logout}
            style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="dash-main">
        <header className="dash-top">
          <strong>Secure Workspace</strong>
          <span>
            {user?.name || 'Authorized User'} <b> · </b> {user?.email}
          </span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Welcome back, {user?.name?.split(' ')[0] || 'User'}.</h1>
              <p>Your protected files, active sharing links, and tamper verification status.</p>
            </div>
            <label className="button" style={{ cursor: 'pointer' }}>
              <Plus size={16} /> Upload & Encrypt
              <input type="file" multiple hidden onChange={onFileInput} />
            </label>
          </div>

          {error && <div className="auth-error" style={{ marginBottom: 18 }}>{error}</div>}

          {/* Metric Cards */}
          <div className="stats">
            {stats.map(([label, val, Icon]) => (
              <div className="stat" key={label}>
                <div className="stat-head">
                  {label}
                  <span className="stat-icon">
                    <Icon size={15} />
                  </span>
                </div>
                <strong>{val}</strong>
                <small>
                  {label === 'Stored Files'
                    ? `${fmt(data.stats.storage_bytes)} encrypted`
                    : label === 'Active Links'
                    ? 'Ready to share'
                    : 'Recorded all time'}
                </small>
              </div>
            ))}
          </div>

          {/* Drag & Drop Upload Zone */}
          <div
            className="upload-zone"
            style={{
              marginTop: 18,
              border: dragActive ? '2px dashed #2563eb' : '1px dashed #cbd5e1',
              background: dragActive ? '#eff6ff' : '#fafcff',
              transition: '0.2s',
            }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <FolderOpen size={28} color="#3b82f6" style={{ margin: 'auto' }} />
            <p style={{ margin: '8px 0 4px', fontWeight: 600, color: '#1e293b' }}>
              {busy ? 'Encrypting & uploading files…' : 'Drag & drop confidential files here'}
            </p>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              AES-256-GCM authenticated encryption applied automatically · Or{' '}
              <label style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
                browse files
                <input type="file" multiple hidden onChange={onFileInput} />
              </label>
            </span>
          </div>

          {/* Files & Recent Activity Grid */}
          <div className="dash-grid">
            {/* Left: Files Table */}
            <section className="panel" id="files">
              <div className="panel-title">
                <h3>Files Stored ({data.files.length})</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={13} style={{ position: 'absolute', left: 8, top: 7, color: '#94a3b8' }} />
                    <input
                      type="text"
                      placeholder="Search files…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{
                        padding: '4px 8px 4px 26px',
                        fontSize: 11,
                        borderRadius: 6,
                        border: '1px solid #e2e8f0',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <Link href="/files" className="text-link" style={{ margin: 0 }}>
                    View all →
                  </Link>
                </div>
              </div>

              {filteredFiles.length ? (
                <table className="files-table">
                  <thead>
                    <tr>
                      <th>FILE NAME</th>
                      <th>SIZE</th>
                      <th>UPLOADED</th>
                      <th style={{ textAlign: 'right' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((f) => (
                      <tr key={f.id}>
                        <td className="file-cell">
                          <Link href={`/files/${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="file-icon">{getFileIcon(f.name)}</span>
                            <div>
                              <span>{f.name}</span>
                              {f.sha256_checksum && (
                                <small style={{ display: 'block', color: '#94a3b8', fontSize: 9, fontFamily: 'monospace' }}>
                                  SHA: {f.sha256_checksum.slice(0, 10)}…
                                </small>
                              )}
                            </div>
                          </Link>
                        </td>
                        <td>{fmt(f.size)}</td>
                        <td>{new Date(f.created_at).toLocaleDateString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            title="Direct Download"
                            onClick={async () => {
                              const r = await fetch(`${API}/api/files/${f.id}/download`, {
                                credentials: 'include',
                              });
                              if (r.ok) {
                                const blob = await r.blob();
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = f.name;
                                a.click();
                                URL.revokeObjectURL(a.href);
                              } else {
                                alert('Decryption failed or file unavailable');
                              }
                            }}
                            style={{ border: 0, background: 'none', color: '#2563eb', cursor: 'pointer', padding: 5 }}
                          >
                            <ArrowDownToLine size={15} />
                          </button>

                          <button
                            title="Create Secure Share Link"
                            onClick={() => {
                              setShareFile(f);
                              setGeneratedLink('');
                              setSharePassword('');
                              setExpiresHours('24');
                              setMaxDownloads('10');
                            }}
                            style={{ border: 0, background: 'none', color: '#059669', cursor: 'pointer', padding: 5 }}
                          >
                            <Share2 size={15} />
                          </button>

                          <Link
                            href={`/files/${f.id}`}
                            title="Inspect Cryptographic Metadata"
                            style={{ color: '#475569', padding: 5, display: 'inline-flex', alignItems: 'center' }}
                          >
                            <Eye size={15} />
                          </Link>

                          <button
                            title="Delete file"
                            onClick={() => remove(f)}
                            style={{ border: 0, background: 'none', color: '#ef4444', cursor: 'pointer', padding: 5 }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">
                  {search ? 'No matching files found.' : 'No files uploaded yet. Add a file to start encrypted storage.'}
                </div>
              )}
            </section>

            {/* Right: Recent Activity Feed */}
            <section className="panel">
              <div className="panel-title">
                <h3>Audit Trail & Activity</h3>
                <Link href="/access-logs" style={{ fontSize: 11, color: '#2563eb' }}>
                  Full log →
                </Link>
              </div>

              {data.activity.length ? (
                data.activity.map((a, i) => (
                  <div className="activity-row" key={i}>
                    <span className="activity-dot">
                      {a.action.includes('download') ? (
                        <ArrowDownToLine size={13} />
                      ) : a.action.includes('upload') ? (
                        <ArrowUpFromLine size={13} />
                      ) : a.action.includes('share') ? (
                        <Share2 size={13} />
                      ) : (
                        <ShieldCheck size={13} />
                      )}
                    </span>
                    <div>
                      <b>{a.detail}</b>
                      <small>{new Date(a.created_at).toLocaleString()}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">Actions and file downloads will be logged here.</div>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* Share Modal Dialog */}
      {shareFile && (
        <div className="modal-backdrop" onClick={() => setShareFile(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Secure Share: {shareFile.name}</h3>
              <button className="modal-close" onClick={() => setShareFile(null)}>
                <X size={18} />
              </button>
            </div>

            {!generatedLink ? (
              <div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>
                  Configure link security parameters. Only recipients holding the secure high-entropy token can access this file.
                </p>

                <div className="field">
                  <label htmlFor="modal-expires">Link Expiration</label>
                  <select
                    id="modal-expires"
                    value={expiresHours}
                    onChange={(e) => setExpiresHours(e.target.value)}
                    style={{
                      height: 40,
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: 13,
                    }}
                  >
                    <option value="1">1 Hour</option>
                    <option value="24">24 Hours (1 Day)</option>
                    <option value="168">7 Days (1 Week)</option>
                    <option value="720">30 Days</option>
                    <option value="unlimited">No Expiration</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modal-downloads">Maximum Downloads Limit</label>
                  <select
                    id="modal-downloads"
                    value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    style={{
                      height: 40,
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: 13,
                    }}
                  >
                    <option value="1">1 Download (Self-destruct)</option>
                    <option value="5">5 Downloads</option>
                    <option value="10">10 Downloads</option>
                    <option value="25">25 Downloads</option>
                    <option value="unlimited">Unlimited Downloads</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="modal-password">Optional Password Protection (Argon2id)</label>
                  <input
                    id="modal-password"
                    type="password"
                    placeholder="Leave blank for token-only access"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                  />
                </div>

                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" className="btn-outline" onClick={() => setShareFile(null)}>
                    Cancel
                  </button>
                  <button type="button" className="button" disabled={shareBusy} onClick={createShareLink}>
                    {shareBusy ? 'Generating…' : 'Generate Secure Link'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ padding: '12px 14px', background: '#ecfdf5', borderRadius: 8, color: '#065f46', marginBottom: 16 }}>
                  <strong>Secure link ready!</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                    This link grants access based on your configured limits. Send it directly to your recipient.
                  </p>
                </div>

                <div className="field">
                  <label>Sharing URL</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" readOnly value={generatedLink} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                    <button type="button" className="button" onClick={copyToClipboard} style={{ padding: '0 14px' }}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-outline" onClick={() => setShareFile(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
