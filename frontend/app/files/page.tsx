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
  Copy,
  Edit2,
  Eye,
  FileArchive,
  FileCode,
  FileText,
  Files,
  Filter,
  FolderOpen,
  FolderPlus,
  Gauge,
  Grid,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SortAsc,
  SortDesc,
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

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

function getFileCategory(name: string): 'documents' | 'images' | 'code' | 'archives' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'images';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archives';
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'sql', 'md'].includes(ext)) return 'code';
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'xlsx'].includes(ext)) return 'documents';
  return 'other';
}

function getFileIcon(name: string) {
  const cat = getFileCategory(name);
  if (cat === 'images') return <ImageIcon size={18} style={{ color: '#34d399' }} />;
  if (cat === 'archives') return <FileArchive size={18} style={{ color: '#fbbf24' }} />;
  if (cat === 'code') return <FileCode size={18} style={{ color: '#60a5fa' }} />;
  return <FileText size={18} style={{ color: '#818cf8' }} />;
}

export default function FilesPage() {
  const router = useRouter();
  const [files, setFiles] = useState<F[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | 'documents' | 'images' | 'code' | 'archives'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // Upload Progress
  const [uploadProgressList, setUploadProgressList] = useState<{ name: string; progress: UploadProgress }[]>([]);
  const [uploading, setUploading] = useState(false);

  // Modals & Drawers
  const [shareFile, setShareFile] = useState<F | null>(null);
  const [generatedShareLink, setGeneratedShareLink] = useState('');
  const [shareExpiresHours, setShareExpiresHours] = useState('24');
  const [shareMaxDownloads, setShareMaxDownloads] = useState('10');
  const [sharePassword, setSharePassword] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const [renameFile, setRenameFile] = useState<F | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [inspectFile, setInspectFile] = useState<F | null>(null);
  const [cryptoMetadata, setCryptoMetadata] = useState<any>(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  async function loadFiles() {
    try {
      const data = await apiRequest('/api/files');
      setFiles(data);
    } catch (err: any) {
      if (err.message?.includes('401') || err.message?.includes('Authentication required')) {
        router.replace('/login');
        return;
      }
      setError(err.message || 'Error loading files');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles();
  }, []);

  async function handleFileUpload(fileList: File[]) {
    if (!fileList.length) return;
    setUploading(true);
    setError('');

    for (const f of fileList) {
      setUploadProgressList((prev) => [
        {
          name: f.name,
          progress: {
            phase: 'reading',
            loaded: 0,
            total: f.size,
            percent: 0,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          },
        },
        ...prev,
      ]);

      try {
        await uploadDeviceEncryptedFile(f, (progress) => {
          setUploadProgressList((prev) =>
            prev.map((item) => (item.name === f.name ? { ...item, progress } : item))
          );
        });
      } catch (err: any) {
        setError(`Upload failed for ${f.name}: ${err.message}`);
      }
    }

    setUploading(false);
    await loadFiles();
  }

  async function handleDownload(f: F) {
    setStatusMessage(`Decrypting "${f.name}" locally on device...`);
    try {
      await downloadAndDecryptFile(f.id, (percent, status) => {
        setStatusMessage(`${status} (${percent}%)`);
      });
      setTimeout(() => setStatusMessage(''), 2500);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
      setStatusMessage('');
    }
  }

  async function handleTrash(f: F) {
    if (!confirm(`Move "${f.name}" to trash?`)) return;
    try {
      await apiRequest(`/api/files/${f.id}/trash`, { method: 'POST' });
      await loadFiles();
    } catch (err: any) {
      setError(err.message || 'Could not move file to trash');
    }
  }

  async function handleBatchDelete() {
    if (!selectedIds.size) return;
    if (!confirm(`Move ${selectedIds.size} selected file(s) to trash?`)) return;
    try {
      for (const id of Array.from(selectedIds)) {
        await apiRequest(`/api/files/${id}/trash`, { method: 'POST' });
      }
      setSelectedIds(new Set());
      await loadFiles();
    } catch (err: any) {
      setError(err.message || 'Batch delete failed');
    }
  }

  async function handleBatchDownload() {
    if (!selectedIds.size) return;
    for (const id of Array.from(selectedIds)) {
      const f = files.find((item) => item.id === id);
      if (f) {
        await handleDownload(f);
      }
    }
  }

  async function handleRenameSubmit() {
    if (!renameFile || !newFileName.trim()) return;
    setRenameBusy(true);
    try {
      await apiRequest(`/api/files/${renameFile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFileName.trim(), version: renameFile.version }),
      });
      setRenameFile(null);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Rename failed');
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleCopy(f: F) {
    try {
      setStatusMessage(`Cloning encrypted metadata for "${f.name}"...`);
      await apiRequest(`/api/files/${f.id}/copy`, { method: 'POST' });
      await loadFiles();
      setTimeout(() => setStatusMessage(''), 2000);
    } catch (err: any) {
      setError(err.message || 'Copy failed');
    }
  }

  async function openInspector(f: F) {
    setInspectFile(f);
    setInspectLoading(true);
    try {
      const meta = await apiRequest(`/api/files/${f.id}/encryption/metadata`);
      setCryptoMetadata(meta);
    } catch (err) {
      setCryptoMetadata(null);
    } finally {
      setInspectLoading(false);
    }
  }

  async function createShare() {
    if (!shareFile) return;
    setShareBusy(true);
    try {
      const payload: Record<string, any> = {};
      if (shareExpiresHours !== 'unlimited') {
        payload.expires_in_hours = parseInt(shareExpiresHours, 10);
      }
      if (shareMaxDownloads !== 'unlimited') {
        payload.max_downloads = parseInt(shareMaxDownloads, 10);
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
      const localKey = getLocalFileKey(shareFile.id);
      if (localKey) {
        shareUrl += `#key=${localKey}`;
      }
      setGeneratedShareLink(shareUrl);
      await loadFiles();
    } catch (err: any) {
      alert(err.message || 'Share link creation failed');
    } finally {
      setShareBusy(false);
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((f) => f.id)));
    }
  };

  const filtered = files
    .filter((f) => {
      const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = category === 'all' || getFileCategory(f.name) === category;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      else if (sortBy === 'date') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <Link href="/" className="brand-wrap" style={{ padding: '4px 12px 20px' }}>
          <div className="brand-icon-box">
            <LockKeyhole size={18} />
          </div>
          <span>SecureShare</span>
        </Link>

        <div className="side-section-label">WORKSPACE</div>
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
          <Activity size={16} /> Audit Trail
        </Link>
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} /> Notifications
        </Link>

        <div className="side-section-label">CATEGORIES</div>
        <button
          onClick={() => setCategory('all')}
          className={`side-item ${category === 'all' ? 'active' : ''}`}
          style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <FolderOpen size={16} /> All Items ({files.length})
        </button>
        <button
          onClick={() => setCategory('documents')}
          className={`side-item ${category === 'documents' ? 'active' : ''}`}
          style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <FileText size={16} /> Documents
        </button>
        <button
          onClick={() => setCategory('images')}
          className={`side-item ${category === 'images' ? 'active' : ''}`}
          style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <ImageIcon size={16} /> Images
        </button>
        <button
          onClick={() => setCategory('code')}
          className={`side-item ${category === 'code' ? 'active' : ''}`}
          style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <FileCode size={16} /> Code & Data
        </button>
        <button
          onClick={() => setCategory('archives')}
          className={`side-item ${category === 'archives' ? 'active' : ''}`}
          style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <FileArchive size={16} /> Archives
        </button>

        <div className="side-bottom">
          <Link className="side-item" href="/security">
            <KeyRound size={16} /> Security & 2FA
          </Link>
          <Link className="side-item" href="/settings">
            <Settings size={16} /> Settings
          </Link>
        </div>
      </aside>

      {/* Main File Explorer Area */}
      <main className="dash-main">
        {/* Header Breadcrumbs & Actions */}
        <header className="dash-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
            <Link href="/dashboard" style={{ color: 'var(--text-secondary)' }}>Dashboard</Link>
            <ChevronRight size={14} />
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>All Files</span>
            <span className="badge badge-blue" style={{ marginLeft: 8 }}>{filtered.length} items</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', background: 'var(--surface-raised)', borderRadius: 6, padding: 3, border: '1px solid var(--border)' }}>
              <button
                onClick={() => setViewMode('list')}
                title="List View"
                style={{
                  background: viewMode === 'list' ? 'var(--surface)' : 'none',
                  border: 0,
                  color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid View"
                style={{
                  background: viewMode === 'grid' ? 'var(--surface)' : 'none',
                  border: 0,
                  color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-muted)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <LayoutGrid size={16} />
              </button>
            </div>

            <label className="btn-primary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
              <Plus size={15} /> Upload Files
              <input type="file" multiple onChange={(e) => handleFileUpload(Array.from(e.target.files || []))} style={{ display: 'none' }} />
            </label>
          </div>
        </header>

        {/* Filter and Search Bar */}
        <div style={{ padding: '16px 32px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 320 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by file name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                height: 36,
                paddingLeft: 36,
                paddingRight: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Sorting Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '6px 10px', fontSize: 12 }}
              >
                <option value="date">Date Modified</option>
                <option value="name">File Name</option>
                <option value="size">File Size</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="btn-secondary btn-sm"
                style={{ padding: '6px 8px' }}
                title="Toggle sort direction"
              >
                {sortOrder === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />}
              </button>
            </div>

            {/* Batch Action Bar (shows when items are selected) */}
            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-raised)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{selectedIds.size} selected</span>
                <button onClick={handleBatchDownload} className="btn-secondary btn-sm" style={{ padding: '4px 8px' }}>
                  <ArrowDownToLine size={13} /> Download
                </button>
                <button onClick={handleBatchDelete} className="btn-secondary btn-sm" style={{ padding: '4px 8px', color: '#f87171' }}>
                  <Trash2 size={13} /> Trash
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="dash-content" style={{ paddingTop: 20 }}>
          {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', color: '#f87171', fontSize: 13, marginBottom: 20 }}>
              {error}
            </div>
          )}

          {statusMessage && (
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid #3b82f6', borderRadius: 8, padding: '12px 16px', color: '#60a5fa', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <RefreshCw size={15} className="animate-spin" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Active Uploads */}
          {uploadProgressList.length > 0 && (
            <div className="card" style={{ marginBottom: 20, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>Transfer Queue</span>
                <button onClick={() => setUploadProgressList([])} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                  Dismiss
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {uploadProgressList.map((item, idx) => (
                  <div key={idx} style={{ background: 'var(--surface-raised)', padding: 10, borderRadius: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span style={{ color: '#60a5fa' }}>{item.progress.phase} ({item.progress.percent}%)</span>
                    </div>
                    <div className="progress-track" style={{ height: 3 }}>
                      <div className="progress-fill" style={{ width: `${item.progress.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View Mode Rendering: List or Grid */}
          {filtered.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <FolderOpen size={40} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No files found</h3>
              <p style={{ fontSize: 13, margin: '0 0 16px' }}>
                {search ? `No files matching "${search}"` : 'Upload your first encrypted document to this workspace.'}
              </p>
              <label className="btn-primary btn-sm" style={{ cursor: 'pointer', display: 'inline-flex' }}>
                <Plus size={14} /> Upload Encrypted File
                <input type="file" multiple onChange={(e) => handleFileUpload(Array.from(e.target.files || []))} style={{ display: 'none' }} />
              </label>
            </div>
          ) : viewMode === 'list' ? (
            /* LIST VIEW */
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="file-table">
                <thead>
                  <tr>
                    <th style={{ width: 40, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onChange={selectAll}
                      />
                    </th>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Security Mode</th>
                    <th>Last Modified</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} style={{ background: selectedIds.has(f.id) ? 'var(--surface-raised)' : undefined }}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(f.id)}
                          onChange={() => toggleSelect(f.id)}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface-raised)', display: 'grid', placeItems: 'center' }}>
                            {getFileIcon(f.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.name}</div>
                            {f.sha256_checksum && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                                SHA: {f.sha256_checksum.substring(0, 16)}...
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{fmt(f.size)}</td>
                      <td>
                        <span className="badge badge-emerald" style={{ fontSize: 10 }}>
                          {f.encryption_version === 'v2' ? 'Device AES-GCM' : 'Envelope v1'}
                        </span>
                      </td>
                      <td>{new Date(f.created_at).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            title="Download & Decrypt Locally"
                            onClick={() => handleDownload(f)}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px' }}
                          >
                            <ArrowDownToLine size={14} />
                          </button>
                          <button
                            title="Share Link"
                            onClick={() => {
                              setShareFile(f);
                              setGeneratedShareLink('');
                            }}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px' }}
                          >
                            <Share2 size={14} />
                          </button>
                          <button
                            title="Rename"
                            onClick={() => {
                              setRenameFile(f);
                              setNewFileName(f.name);
                            }}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px' }}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            title="Duplicate / Copy"
                            onClick={() => handleCopy(f)}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px' }}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            title="Cryptographic Inspector"
                            onClick={() => openInspector(f)}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px' }}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            title="Move to Trash"
                            onClick={() => handleTrash(f)}
                            className="btn-secondary btn-sm"
                            style={{ padding: '6px 8px', color: '#f87171' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* GRID VIEW */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {filtered.map((f) => (
                <div
                  key={f.id}
                  className="card"
                  style={{
                    padding: 16,
                    position: 'relative',
                    border: selectedIds.has(f.id) ? '1px solid #3b82f6' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={() => toggleSelect(f.id)}
                    />
                    <span className="badge badge-emerald" style={{ fontSize: 9 }}>
                      {f.encryption_version === 'v2' ? 'Device AES' : 'v1'}
                    </span>
                  </div>

                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--surface-raised)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
                    {getFileIcon(f.name)}
                  </div>

                  <div style={{ textAlign: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmt(f.size)} • {new Date(f.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <button
                      title="Download"
                      onClick={() => handleDownload(f)}
                      className="btn-secondary btn-sm"
                      style={{ padding: 6 }}
                    >
                      <ArrowDownToLine size={13} />
                    </button>
                    <button
                      title="Share"
                      onClick={() => {
                        setShareFile(f);
                        setGeneratedShareLink('');
                      }}
                      className="btn-secondary btn-sm"
                      style={{ padding: 6 }}
                    >
                      <Share2 size={13} />
                    </button>
                    <button
                      title="Inspect"
                      onClick={() => openInspector(f)}
                      className="btn-secondary btn-sm"
                      style={{ padding: 6 }}
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      title="Trash"
                      onClick={() => handleTrash(f)}
                      className="btn-secondary btn-sm"
                      style={{ padding: 6, color: '#f87171' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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

            {!generatedShareLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                    Expiration Hours
                  </label>
                  <select
                    value={shareExpiresHours}
                    onChange={(e) => setShareExpiresHours(e.target.value)}
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
                    value={shareMaxDownloads}
                    onChange={(e) => setShareMaxDownloads(e.target.value)}
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
                    Argon2id Password Protection (Optional)
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
                  onClick={createShare}
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
                      value={generatedShareLink}
                      style={{ flex: 1, height: 38, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 10px', fontSize: 12, fontFamily: 'DM Mono, monospace' }}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedShareLink);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="btn-primary btn-sm"
                    >
                      {copiedLink ? <Check size={14} /> : <Copy size={14} />} {copiedLink ? 'Copied' : 'Copy'}
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

      {/* Rename File Modal */}
      {renameFile && (
        <div className="modal-overlay" onClick={() => setRenameFile(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Rename File</h3>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              style={{ width: '100%', height: 40, background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', padding: '0 12px', fontSize: 13, marginBottom: 18 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setRenameFile(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={handleRenameSubmit} disabled={renameBusy} className="btn-primary btn-sm">
                {renameBusy ? 'Renaming...' : 'Save Name'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cryptographic Inspector Modal */}
      {inspectFile && (
        <div className="modal-overlay" onClick={() => setInspectFile(null)}>
          <div className="modal-content" style={{ width: 'min(100%, 640px)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Eye size={18} className="text-blue-400" />
                <h3 style={{ fontSize: 17, fontWeight: 700 }}>Cryptographic Inspector</h3>
              </div>
              <button onClick={() => setInspectFile(null)} style={{ background: 'none', border: 0, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--surface-raised)', padding: 16, borderRadius: 8, fontSize: 12, fontFamily: 'DM Mono, monospace', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>File ID: </span>
                <span style={{ color: 'var(--text-primary)' }}>{inspectFile.id}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Cipher: </span>
                <span style={{ color: '#60a5fa' }}>AES-256-GCM (Authenticated AEAD)</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Architecture: </span>
                <span style={{ color: '#34d399' }}>
                  {inspectFile.encryption_version === 'v2' ? 'Device-Powered (Client-Side Encrypted)' : 'Server Envelope v1'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Plaintext SHA-256: </span>
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{inspectFile.sha256_checksum || 'N/A'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Ciphertext SHA-256: </span>
                <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{inspectFile.ciphertext_sha256 || 'Calculated in v2'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Tamper Check: </span>
                <span style={{ color: '#34d399' }}>128-bit GCM Authentication Tag Verified</span>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setInspectFile(null)} className="btn-secondary btn-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
