'use client';

import { ChangeEvent, DragEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Clock,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode,
  FileText,
  Files,
  FolderOpen,
  FolderPlus,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  X,
  Zap
} from 'lucide-react';
import { apiRequest, API_URL, setAuthToken } from '../lib/api';
import { uploadDeviceEncryptedFile, getLocalFileKey, UploadProgress } from '../lib/uploader';
import { downloadAndDecryptFile } from '../lib/downloader';

type F = {
  id: string;
  name: string;
  size: number;
  content_type: string;
  sha256_checksum?: string;
  ciphertext_sha256?: string;
  version?: number;
  encryption_version?: string;
  is_deleted?: boolean;
  created_at: string;
};

type SyncStatus = {
  active_files_count: number;
  trashed_files_count: number;
  total_bytes_used: number;
  quota_bytes: number;
  registered_devices_count: number;
  server_time: string;
};

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return <ImageIcon size={16} className="text-emerald-400" />;
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext || '')) return <FileArchive size={16} className="text-amber-400" />;
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'sql'].includes(ext || '')) return <FileCode size={16} className="text-blue-400" />;
  return <FileText size={16} className="text-indigo-400" />;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [files, setFiles] = useState<F[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Device-Powered Upload State
  const [uploadQueue, setUploadQueue] = useState<
    { name: string; size: number; progress: UploadProgress }[]
  >([]);
  const [uploading, setUploading] = useState(false);

  // Sharing Modal
  const [shareFile, setShareFile] = useState<F | null>(null);
  const [expiresHours, setExpiresHours] = useState('24');
  const [maxDownloads, setMaxDownloads] = useState('10');
  const [sharePassword, setSharePassword] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  // Inspector Drawer
  const [inspectFile, setInspectFile] = useState<F | null>(null);
  const [downloadStatus, setDownloadStatus] = useState('');

  async function loadDashboard() {
    try {
      const [u, fList, act, sync] = await Promise.all([
        apiRequest('/api/auth/me'),
        apiRequest('/api/files'),
        apiRequest('/api/dashboard'),
        apiRequest('/api/sync/status').catch(() => null),
      ]);
      setUser(u);
      setFiles(fList);
      setActivities(act.activity || []);
      setSyncStatus(sync);
    } catch (err: any) {
      if (err.message?.includes('401') || err.message?.includes('Authentication required')) {
        router.replace('/login');
        return;
      }
      setError(err.message || 'Error loading dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleFilesUpload(fileList: File[]) {
    if (!fileList.length) return;
    setUploading(true);
    setError('');

    for (const file of fileList) {
      const queueItem = {
        name: file.name,
        size: file.size,
        progress: {
          phase: 'reading' as const,
          loaded: 0,
          total: file.size,
          percent: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        },
      };

      setUploadQueue((prev) => [queueItem, ...prev]);

      try {
        await uploadDeviceEncryptedFile(file, (p) => {
          setUploadQueue((prev) =>
            prev.map((item) => (item.name === file.name ? { ...item, progress: p } : item))
          );
        });
      } catch (err: any) {
        setError(`Upload failed for ${file.name}: ${err.message}`);
      }
    }

    setUploading(false);
    await loadDashboard();
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

      const res = await apiRequest(`/api/files/${shareFile.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let shareUrl = res.url;
      // Append zero-knowledge decryption key fragment if available on this device
      const localKey = getLocalFileKey(shareFile.id);
      if (localKey) {
        shareUrl += `#key=${localKey}`;
      }

      setGeneratedLink(shareUrl);
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Error creating share link');
    } finally {
      setShareBusy(false);
    }
  }

  async function handleDownload(f: F) {
    setDownloadStatus('Preparing download...');
    try {
      await downloadAndDecryptFile(f.id, (pct, status) => {
        setDownloadStatus(`${status} (${pct}%)`);
      });
      setTimeout(() => setDownloadStatus(''), 2000);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
      setDownloadStatus('');
    }
  }

  async function handleTrash(f: F) {
    if (!confirm(`Move "${f.name}" to trash?`)) return;
    try {
      await apiRequest(`/api/files/${f.id}/trash`, { method: 'POST' });
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Could not move file to trash');
    }
  }

  async function logout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {}
    setAuthToken(null);
    router.replace('/');
  }

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalUsedBytes = syncStatus?.total_bytes_used || files.reduce((acc, f) => acc + f.size, 0);
  const quotaBytes = syncStatus?.quota_bytes || 1024 * 1024 * 1024; // 1GB
  const storagePercent = Math.min(Math.round((totalUsedBytes / quotaBytes) * 100), 100);

  return (
    <div className="app-shell">
      {/* 1. Sidebar Navigation */}
      <aside className="sidebar">
        <Link href="/" className="brand-wrap" style={{ padding: '4px 12px 20px' }}>
          <div className="brand-icon-box">
            <LockKeyhole size={18} />
          </div>
          <span>SecureShare</span>
        </Link>

        <div className="side-section-label">WORKSPACE</div>
        <Link className="side-item active" href="/dashboard">
          <Gauge size={16} /> Overview
        </Link>
        <Link className="side-item" href="/files">
          <Files size={16} /> All Files
        </Link>
        <Link className="side-item" href="/shared">
          <Share2 size={16} /> Sharing Links
        </Link>
        <Link className="side-item" href="/access-logs">
          <Activity size={16} /> Audit Trail
        </Link>
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} /> Notifications
        </Link>

        <div className="side-section-label">STORAGE & SYNC</div>
        <div style={{ padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            <span>Cloud Storage</span>
            <span>{storagePercent}%</span>
          </div>
          <div className="progress-track" style={{ height: 5 }}>
            <div className="progress-fill" style={{ width: `${storagePercent}%` }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
            {fmt(totalUsedBytes)} of {fmt(quotaBytes)}
          </div>
        </div>

        <div className="side-section-label">ACCOUNT</div>
        <Link className="side-item" href="/security">
          <KeyRound size={16} /> Security & 2FA
        </Link>
        <Link className="side-item" href="/settings">
          <Settings size={16} /> Settings
        </Link>

        <div className="side-bottom">
          <div style={{ padding: '0 12px 10px', fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name || 'Loading...'}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{user?.email}</div>
          </div>
          <button
            onClick={logout}
            className="side-item"
            style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      {/* 2. Main Dashboard Area */}
      <main className="dash-main">
        {/* Top Header */}
        <header className="dash-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, maxWidth: 480 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search encrypted files... (⌘K)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  height: 38,
                  paddingLeft: 36,
                  paddingRight: 12,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', padding: '5px 10px', borderRadius: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} />
              <span>Device-Powered</span>
            </div>

            <label className="btn-primary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
              <Plus size={15} /> Upload Encrypted
              <input type="file" multiple onChange={(e) => handleFilesUpload(Array.from(e.target.files || []))} style={{ display: 'none' }} />
            </label>
          </div>
        </header>

        {/* Dashboard Body Content */}
        <div className="dash-content">
          {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', color: '#f87171', fontSize: 13, marginBottom: 20 }}>
              {error}
            </div>
          )}

          {downloadStatus && (
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', borderRadius: 8, padding: '12px 16px', color: '#60a5fa', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <RefreshCw size={15} className="animate-spin" />
              <span>{downloadStatus}</span>
            </div>
          )}

          {/* Quick Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                <span>ENCRYPTED OBJECTS</span>
                <Files size={16} className="text-blue-400" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{files.length}</div>
              <div style={{ fontSize: 11, color: '#34d399', marginTop: 4 }}>100% Client-side AES-256-GCM</div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                <span>CLOUD STORAGE USED</span>
                <Cloud size={16} className="text-emerald-400" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(totalUsedBytes)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Private S3 Presigned Vault</div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                <span>SYNCED DEVICES</span>
                <Smartphone size={16} className="text-amber-400" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{syncStatus?.registered_devices_count || 1}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Delta Sync Cursor Active</div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                <span>SECURITY ARCHITECTURE</span>
                <Zap size={16} className="text-indigo-400" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Zero-Knowledge</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Render Coordinates Only</div>
            </div>
          </div>

          {/* Active Upload Queue (if any) */}
          {uploadQueue.length > 0 && (
            <div className="card" style={{ marginBottom: 24, padding: 18, border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                  <UploadCloud size={16} className="text-blue-400" />
                  <span>Device Processing & Upload Pipeline</span>
                </div>
                <button onClick={() => setUploadQueue([])} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                  Clear History
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {uploadQueue.map((item, idx) => (
                  <div key={idx} style={{ background: 'var(--surface-raised)', padding: '10px 14px', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span style={{ color: item.progress.percent === 100 ? '#34d399' : '#60a5fa' }}>
                        {item.progress.phase === 'encrypting' && 'Encrypting locally with AES-256-GCM...'}
                        {item.progress.phase === 'uploading' && `Uploading ciphertext (${item.progress.percent}%) • ${(item.progress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`}
                        {item.progress.phase === 'confirming' && 'Registering sync metadata...'}
                        {item.progress.phase === 'completed' && 'Completed & Synced'}
                      </span>
                    </div>
                    <div className="progress-track" style={{ height: 4 }}>
                      <div className="progress-fill" style={{ width: `${item.progress.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drag & Drop Upload Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragActive ? '#3b82f6' : 'var(--border)'}`,
              background: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'var(--surface)',
              borderRadius: 'var(--radius-md)',
              padding: '36px 20px',
              textAlign: 'center',
              marginBottom: 28,
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-raised)', color: '#60a5fa', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
              <UploadCloud size={22} />
            </div>
            <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Drag and drop files to encrypt and transfer</h4>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              Files are encrypted locally on this device using AES-256-GCM before transferring ciphertext to private cloud storage.
            </p>
            <label className="btn-secondary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex' }}>
              <span>Browse Local Files</span>
              <input type="file" multiple onChange={(e) => handleFilesUpload(Array.from(e.target.files || []))} style={{ display: 'none' }} />
            </label>
          </div>

          {/* Main Content Grid: Recent Files & Live Activity */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
            {/* Recent Files Table */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Recent Encrypted Files</h3>
                <Link href="/files" style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  View All Files <ChevronRight size={14} />
                </Link>
              </div>

              {filteredFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  No encrypted files yet. Upload a file above to begin.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="file-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Size</th>
                        <th>Cipher</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFiles.slice(0, 8).map((f) => (
                        <tr key={f.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--surface-raised)', display: 'grid', placeItems: 'center' }}>
                                {getFileIcon(f.name)}
                              </div>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.name}
                              </span>
                            </div>
                          </td>
                          <td>{fmt(f.size)}</td>
                          <td>
                            <span className="badge badge-emerald" style={{ fontSize: 10 }}>
                              {f.encryption_version === 'v2' ? 'Device AES-GCM' : 'Envelope v1'}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                title="Download & Locally Decrypt"
                                onClick={() => handleDownload(f)}
                                className="btn-secondary btn-sm"
                                style={{ padding: 6 }}
                              >
                                <ArrowDownToLine size={13} />
                              </button>
                              <button
                                title="Create Zero-Knowledge Share Link"
                                onClick={() => {
                                  setShareFile(f);
                                  setGeneratedLink('');
                                }}
                                className="btn-secondary btn-sm"
                                style={{ padding: 6 }}
                              >
                                <Share2 size={13} />
                              </button>
                              <button
                                title="Move to Trash"
                                onClick={() => handleTrash(f)}
                                className="btn-secondary btn-sm"
                                style={{ padding: 6, color: '#f87171' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Cryptographic Activity Timeline */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Access & Security Audit</h3>
                <Link href="/access-logs" style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Full Audit Trail <ChevronRight size={14} />
                </Link>
              </div>

              {activities.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  No recent audit activities recorded.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activities.slice(0, 6).map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', display: 'grid', placeItems: 'center', marginTop: 2 }}>
                        <Activity size={13} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{a.detail}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {a.action} • {new Date(a.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Share Modal Dialog */}
      {shareFile && (
        <div className="modal-overlay" onClick={() => setShareFile(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Share2 size={18} className="text-blue-400" />
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Share "{shareFile.name}"</h3>
              </div>
              <button onClick={() => setShareFile(null)} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {!generatedLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Expiration Hours
                  </label>
                  <select
                    value={expiresHours}
                    onChange={(e) => setExpiresHours(e.target.value)}
                    style={{ width: '100%', height: 38, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 10px', fontSize: 13 }}
                  >
                    <option value="1">1 Hour</option>
                    <option value="24">24 Hours (1 Day)</option>
                    <option value="72">72 Hours (3 Days)</option>
                    <option value="168">7 Days</option>
                    <option value="unlimited">No Expiration</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Maximum Allowed Downloads
                  </label>
                  <select
                    value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    style={{ width: '100%', height: 38, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 10px', fontSize: 13 }}
                  >
                    <option value="1">1 Download (One-time transfer)</option>
                    <option value="5">5 Downloads</option>
                    <option value="10">10 Downloads</option>
                    <option value="50">50 Downloads</option>
                    <option value="unlimited">Unlimited Downloads</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Optional Argon2id Password Protection
                  </label>
                  <input
                    type="password"
                    placeholder="Leave empty for unpassworded link"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    style={{ width: '100%', height: 38, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 10px', fontSize: 13 }}
                  />
                </div>

                <div style={{ background: 'var(--surface-raised)', padding: 12, borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  🔒 <b>Zero-Knowledge Key Encoding:</b> The 256-bit decryption key will be attached as a URL fragment (#key=...) which is processed solely by the recipient browser and never sent over HTTP to Render.
                </div>

                <button
                  onClick={createShareLink}
                  disabled={shareBusy}
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                >
                  {shareBusy ? 'Generating Cryptographic Link...' : 'Create Secure Share Link'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', padding: 12, borderRadius: 8, color: '#34d399', fontSize: 13 }}>
                  ✓ Secure share link generated successfully!
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Zero-Knowledge Share URL
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      readOnly
                      value={generatedLink}
                      style={{ flex: 1, height: 38, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 10px', fontSize: 12, fontFamily: 'DM Mono, monospace' }}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedLink);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="btn-primary btn-sm"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <button onClick={() => setShareFile(null)} className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
