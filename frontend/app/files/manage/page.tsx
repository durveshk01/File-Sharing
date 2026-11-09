'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, Clock, FileText, RefreshCw, RotateCcw, Trash2, Users } from 'lucide-react';
import WorkspaceShell from '../../components/workspace-shell';
import { apiRequest, requireBrowserAccount } from '../../lib/api';
import { downloadAndDecryptFile } from '../../lib/downloader';

type Mode = 'trash' | 'shared' | 'pending';
type ManagedFile = { id: string; name: string; size: number; access_role?: string; owner_name?: string; status?: string; expires_at?: string };
const modes: { id: Mode; title: string; icon: typeof Trash2 }[] = [
  { id: 'trash', title: 'Trash', icon: Trash2 }, { id: 'shared', title: 'Shared with me', icon: Users }, { id: 'pending', title: 'Unfinished uploads', icon: Clock },
];
const fmt = (size: number) => size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;

export default function FileManagementPage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    setMode(view === 'shared' || view === 'pending' ? view : 'trash');
  }, []);
  async function load(view: Mode, append = false) {
    setLoading(true); setError('');
    try {
      await requireBrowserAccount();
      const path = view === 'shared' ? '/api/files/shared-with-me' : `/api/files/${view}`;
      const data: ManagedFile[] = await apiRequest(`${path}?limit=500&offset=${append ? files.length : 0}`);
      setFiles((previous) => append ? Array.from(new Map([...previous, ...data].map((file) => [file.id, file])).values()) : data);
      setHasMore(view !== 'pending' && data.length === 500);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not load files'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (mode) void load(mode); }, [mode]);
  function changeMode(view: Mode) { setMode(view); setMessage(''); window.history.replaceState(null, '', `/files/manage?view=${view}`); }
  async function mutate(file: ManagedFile, action: 'restore' | 'delete') {
    if (action === 'delete' && !confirm(mode === 'pending' ? `Cancel the unfinished upload "${file.name}"?` : `Permanently delete "${file.name}"? This cannot be restored.`)) return;
    setBusy(file.id); setError(''); setMessage('');
    try {
      await apiRequest(`/api/files/${file.id}${action === 'restore' ? '/restore' : ''}`, { method: action === 'restore' ? 'POST' : 'DELETE' });
      if (mode) await load(mode);
      setMessage(action === 'restore' ? `Restored "${file.name}".` : `Removed "${file.name}" and released its storage reservation.`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Operation failed'); }
    finally { setBusy(null); }
  }
  async function download(file: ManagedFile) {
    setBusy(file.id); setError('');
    try { await downloadAndDecryptFile(file.id, (_, status) => setMessage(status)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Download failed'); }
    finally { setBusy(null); }
  }
  return <WorkspaceShell title="File management" actions={<Link className="btn-secondary btn-sm" href="/files">Back to all files</Link>}>
    <div className="dash-heading"><div><h1>Trash, collaborators & transfers</h1><p>Restore files, open shared documents, or release storage held by unfinished uploads.</p></div></div>
    <div className="toolbar" role="tablist" aria-label="File collections">
      {modes.map(({ id, title, icon: Icon }) => <button key={id} role="tab" aria-selected={mode === id} className={`tab-link ${mode === id ? 'active' : ''}`} onClick={() => changeMode(id)}><Icon size={15} style={{ marginRight: 7, verticalAlign: 'middle' }} />{title}</button>)}
      <button className="btn-secondary btn-sm" disabled={loading || !mode} onClick={() => mode && load(mode)}><RefreshCw size={14} />Refresh</button>
    </div>
    {error && <div className="notice-error" role="alert">{error}</div>}
    {message && <div className="notice-success" role="status">{message}</div>}
    {mode === 'trash' && <p style={{ color: 'var(--text-secondary)' }}>Trash still counts toward your quota. Restore keeps the private file key; permanent deletion releases the reservation.</p>}
    {mode === 'shared' && <p style={{ color: 'var(--text-secondary)' }}>VIEWERs can read and download. EDITORs can also rename. For v2 documents, ask the owner for the private file key and import it in file details.</p>}
    <section className="panel">
      {loading ? <div className="empty" role="status">Loading files…</div> : !files.length ? <div className="empty">No files in this collection.</div> :
        <div className="device-list">{files.map((file) => <div key={file.id} className="device-row">
          <div style={{ minWidth: 0 }}><strong style={{ overflowWrap: 'anywhere' }}><FileText size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />{file.name}</strong>
            <small>{fmt(file.size)}{file.owner_name ? ` · From ${file.owner_name} · ${file.access_role}` : file.status ? ` · ${file.status}` : ''}</small></div>
          <div className="toolbar" style={{ margin: 0 }}>
            {mode === 'trash' ? <><button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => mutate(file, 'restore')}><RotateCcw size={14} />Restore</button><button className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => mutate(file, 'delete')}><Trash2 size={14} />Permanently delete</button></> :
              mode === 'pending' ? <button className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => mutate(file, 'delete')}><Trash2 size={14} />Cancel upload</button> :
              <><Link className="btn-secondary btn-sm" href={`/files/${file.id}`}>Open details & key import</Link><button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => download(file)}><ArrowDownToLine size={14} />Download</button></>}
          </div>
        </div>)}</div>}
    </section>
    {hasMore && mode && <button className="btn-secondary" disabled={loading || busy !== null} onClick={() => load(mode, true)}>Load more files</button>}
  </WorkspaceShell>;
}
