'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Files,
  ArrowDownToLine,
  LockKeyhole,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Share2,
  Trash2,
  Gauge,
  KeyRound,
  Activity,
  Search,
  Eye,
  FileText,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  FolderOpen
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

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

function getFileCategory(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'images';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archives';
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'sql', 'md'].includes(ext)) return 'code';
  return 'documents';
}

function getFileIcon(name: string) {
  const cat = getFileCategory(name);
  if (cat === 'images') return <ImageIcon size={15} />;
  if (cat === 'archives') return <FileArchive size={15} />;
  if (cat === 'code') return <FileCode size={15} />;
  return <FileText size={15} />;
}

export default function FilesPage() {
  const [files, setFiles] = useState<F[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | 'documents' | 'images' | 'code' | 'archives'>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function load() {
    try {
      const r = await fetch(`${API}/api/files`, { credentials: 'include' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      if (!r.ok) throw new Error('Could not load files');
      setFiles(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error fetching files');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(e.target.files || []);
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
          throw new Error(b.detail || `Upload failed for ${f.name}`);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function remove(f: F) {
    if (!confirm(`Delete "${f.name}" permanently?`)) return;
    const r = await fetch(`${API}/api/files/${f.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) load();
    else setError('Could not delete file');
  }

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  const filtered = files.filter((f) => {
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'all' || getFileCategory(f.name) === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <LockKeyhole size={17} />
          </span>
          SecureShare
        </Link>
        <div className="side-label">WORKSPACE</div>
        <Link className="side-item" href="/dashboard">
          <Gauge size={16} /> Overview
        </Link>
        <Link className="side-item active" href="/files">
          <Files size={16} /> All Files
        </Link>
        <Link className="side-item" href="/shared">
          <Share2 size={16} /> Sharing Links
        </Link>
        <Link className="side-item" href="/access-logs">
          <Activity size={16} /> Audit Logs
        </Link>
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} /> Notifications
        </Link>

        <div className="side-label">ACCOUNT</div>
        <Link className="side-item" href="/security">
          <KeyRound size={16} /> Security & 2FA
        </Link>
        <Link className="side-item" href="/settings">
          <Settings size={16} /> Settings
        </Link>
        <div className="sidebar-bottom">
          <button
            className="side-item"
            onClick={logout}
            style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-top">
          <strong>Files Explorer</strong>
          <span>{files.length} protected objects stored</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>All Files</h1>
              <p>Manage, inspect, and configure access for your encrypted files.</p>
            </div>
            <label className="button" style={{ cursor: 'pointer' }}>
              <Plus size={16} /> {busy ? 'Encrypting…' : 'Upload File'}
              <input type="file" multiple hidden onChange={upload} />
            </label>
          </div>

          {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

          {/* Search and Filters Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'documents', 'images', 'code', 'archives'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    border: '1px solid #e2e8f0',
                    background: category === cat ? '#2563eb' : '#fff',
                    color: category === cat ? '#fff' : '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search files by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 32px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  outline: 'none',
                  background: '#fff',
                }}
              />
            </div>
          </div>

          {/* Files Table Panel */}
          <div className="panel">
            {loading ? (
              <div className="empty">Loading encrypted files…</div>
            ) : filtered.length ? (
              <table className="files-table">
                <thead>
                  <tr>
                    <th>FILE NAME</th>
                    <th>MIME TYPE</th>
                    <th>SIZE</th>
                    <th>UPLOADED</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id}>
                      <td className="file-cell">
                        <Link href={`/files/${f.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="file-icon">{getFileIcon(f.name)}</span>
                          <div>
                            <span>{f.name}</span>
                            {f.sha256_checksum && (
                              <small style={{ display: 'block', color: '#94a3b8', fontSize: 9, fontFamily: 'monospace' }}>
                                SHA-256: {f.sha256_checksum.slice(0, 16)}…
                              </small>
                            )}
                          </div>
                        </Link>
                      </td>
                      <td>
                        <span className="badge badge-neutral">{f.content_type}</span>
                      </td>
                      <td>{fmt(f.size)}</td>
                      <td>{new Date(f.created_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          title="Download Decrypted File"
                          onClick={async () => {
                            const r = await fetch(`${API}/api/files/${f.id}/download`, { credentials: 'include' });
                            if (r.ok) {
                              const blob = await r.blob();
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = f.name;
                              a.click();
                              URL.revokeObjectURL(a.href);
                            }
                          }}
                          style={{ border: 0, background: 'none', color: '#2563eb', cursor: 'pointer', padding: 5 }}
                        >
                          <ArrowDownToLine size={15} />
                        </button>
                        <Link
                          href={`/files/${f.id}`}
                          title="Inspect Cryptographic Envelope"
                          style={{ color: '#475569', padding: 5, display: 'inline-flex', alignItems: 'center' }}
                        >
                          <Eye size={15} />
                        </Link>
                        <button
                          title="Delete File"
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
                <FolderOpen size={30} style={{ margin: 'auto', marginBottom: 10, color: '#94a3b8' }} />
                <p>No files match your selection.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
