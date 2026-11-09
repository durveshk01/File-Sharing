'use client';

import { API } from '../api';
import { apiFetch, apiRequest, clearBrowserSession } from '../lib/api';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Share2,
  LockKeyhole,
  Gauge,
  Files,
  Activity,
  ShieldCheck,
  KeyRound,
  Settings,
  LogOut,
  Copy,
  Check,
  Trash2,
  Clock,
  Eye,
  Key,
  X,
  FileDown
} from 'lucide-react';



type ShareItem = {
  id: string;
  file_id: string;
  file_name: string;
  expires_at: string | null;
  max_downloads: number | null;
  downloads: number;
  revoked: boolean;
  password_required: boolean;
  created_at?: string;
};

export default function SharedPage() {
  const [items, setItems] = useState<ShareItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked' | 'password'>('all');
  const [err, setErr] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Edit Share Modal
  const [editingShare, setEditingShare] = useState<ShareItem | null>(null);
  const [editHours, setEditHours] = useState('24');
  const [editMaxDownloads, setEditMaxDownloads] = useState('10');
  const [editPassword, setEditPassword] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Logs Modal
  const [viewingLogs, setViewingLogs] = useState<ShareItem | null>(null);
  const [shareLogs, setShareLogs] = useState<any[]>([]);

  const router = useRouter();

  async function load() {
    setErr('');
    try {
      const r = await apiFetch('/api/shares');
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      if (r.ok) {
        setItems(await r.json());
      } else {
        setErr('Could not load sharing links');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Connection error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    if (!confirm('Revoke this share link immediately? Recipient access will be blocked.')) return;
    try { await apiRequest(`/api/shares/${id}`, { method: 'DELETE' }); await load(); }
    catch (error) { setErr(error instanceof Error ? error.message : 'Could not revoke link'); }
  }

  async function openLogsModal(s: ShareItem) {
    setViewingLogs(s);
    try {
      const r = await fetch(`${API}/api/shares/${s.id}/access-logs`, { credentials: 'include' });
      if (r.ok) setShareLogs(await r.json());
      else setShareLogs([]);
    } catch {
      setShareLogs([]);
    }
  }

  async function saveEditShare() {
    if (!editingShare) return;
    setEditBusy(true);
    try {
      const body: Record<string, any> = {};
      if (editHours !== 'keep') body.expires_in_hours = parseInt(editHours, 10);
      if (editMaxDownloads !== 'keep') body.max_downloads = parseInt(editMaxDownloads, 10);
      if (editPassword.trim()) body.password = editPassword.trim();

      const r = await fetch(`${API}/api/shares/${editingShare.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Could not update share settings');
      setEditingShare(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setEditBusy(false);
    }
  }

  async function logout() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); clearBrowserSession(); router.replace('/'); }
    catch (error) { setErr(error instanceof Error ? error.message : 'Could not sign out'); }
  }

  const filtered = items.filter((s) => {
    const isExpired = s.expires_at ? new Date(s.expires_at) <= new Date() : false;
    const isLimitReached = s.max_downloads ? s.downloads >= s.max_downloads : false;
    const isActive = !s.revoked && !isExpired && !isLimitReached;

    if (filter === 'active') return isActive;
    if (filter === 'expired') return isExpired;
    if (filter === 'revoked') return s.revoked;
    if (filter === 'password') return s.password_required;
    return true;
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
        <Link className="side-item" href="/files">
          <Files size={16} /> All Files
        </Link>
        <Link className="side-item active" href="/shared">
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
          <strong>Share Management</strong>
          <span>Manage link expirations, quotas, and access control</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Secure Sharing Links</h1>
              <p>Monitor recipient downloads, enforce limits, and revoke access anytime.</p>
            </div>
            <Link href="/dashboard" className="button">
              + Create Share Link
            </Link>
          </div>

          {err && <div className="auth-error" style={{ marginBottom: 16 }}>{err}</div>}

          {/* Filter Bar */}
          <div className="toolbar">
            {(['all', 'active', 'expired', 'revoked', 'password'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 12,
                  border: '1px solid #cbd5e1',
                  background: filter === f ? '#2563eb' : 'var(--surface-raised)',
                  color: filter === f ? '#fff' : 'var(--text-secondary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {f === 'password' ? 'Password Protected' : f}
              </button>
            ))}
          </div>

          <div className="panel table-scroll">
            {filtered.length ? (
              <table className="files-table">
                <thead>
                  <tr>
                    <th>FILE NAME</th>
                    <th>DOWNLOADS</th>
                    <th>EXPIRATION</th>
                    <th>PROTECTION</th>
                    <th>STATUS</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const isExpired = s.expires_at ? new Date(s.expires_at) <= new Date() : false;
                    const isLimitReached = s.max_downloads ? s.downloads >= s.max_downloads : false;
                    const isActive = !s.revoked && !isExpired && !isLimitReached;

                    return (
                      <tr key={s.id}>
                        <td className="file-cell">
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.file_name}</span>
                            <small style={{ display: 'block', color: '#94a3b8', fontSize: 10 }}>ID: {s.id.slice(0, 8)}…</small>
                          </div>
                        </td>
                        <td>
                          <strong>{s.downloads}</strong>
                          <span style={{ color: '#64748b', fontSize: 11 }}>
                            {s.max_downloads ? ` of ${s.max_downloads} max` : ' (Unlimited)'}
                          </span>
                        </td>
                        <td>
                          {s.expires_at ? (
                            <span style={{ color: isExpired ? '#fda4af' : 'var(--text-secondary)' }}>
                              {new Date(s.expires_at).toLocaleString()}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>No expiration</span>
                          )}
                        </td>
                        <td>
                          {s.password_required ? (
                            <span className="badge badge-warning">
                              <Key size={11} /> Password
                            </span>
                          ) : (
                            <span className="badge badge-neutral">Token Only</span>
                          )}
                        </td>
                        <td>
                          {s.revoked ? (
                            <span className="badge badge-danger">Revoked</span>
                          ) : isExpired ? (
                            <span className="badge badge-warning">Expired</span>
                          ) : isLimitReached ? (
                            <span className="badge badge-warning">Limit Reached</span>
                          ) : (
                            <span className="badge badge-success">Active</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            title="View Share Access Logs"
                            onClick={() => openLogsModal(s)}
                            style={{ border: 0, background: 'none', color: '#2563eb', cursor: 'pointer', padding: 5 }}
                          >
                            <Activity size={15} />
                          </button>

                          <button
                            title="Edit Link Configuration"
                            onClick={() => {
                              setEditingShare(s);
                              setEditHours('keep');
                              setEditMaxDownloads('keep');
                              setEditPassword('');
                            }}
                            style={{ border: 0, background: 'none', color: '#475569', cursor: 'pointer', padding: 5 }}
                          >
                            <Settings size={15} />
                          </button>

                          {!s.revoked && (
                            <button
                              title="Revoke Share Link"
                              onClick={() => revoke(s.id)}
                              style={{ border: 0, background: 'none', color: '#ef4444', cursor: 'pointer', padding: 5 }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty">No sharing links found matching this filter.</div>
            )}
          </div>
        </div>
      </main>

      {/* Edit Share Modal */}
      {editingShare && (
        <div className="modal-backdrop" onClick={() => setEditingShare(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Edit Share: {editingShare.file_name}</h3>
              <button className="modal-close" onClick={() => setEditingShare(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="field">
              <label htmlFor="edit-expiry">Extend Expiration</label>
              <select
                id="edit-expiry"
                value={editHours}
                onChange={(e) => setEditHours(e.target.value)}
                style={{ height: 40, borderRadius: 6, border: '1px solid #cbd5e1', padding: '0 10px', fontSize: 13 }}
              >
                <option value="keep">Keep Current Expiration</option>
                <option value="1">+ 1 Hour</option>
                <option value="24">+ 24 Hours</option>
                <option value="168">+ 7 Days</option>
                <option value="720">+ 30 Days</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="edit-downloads">Adjust Max Downloads</label>
              <select
                id="edit-downloads"
                value={editMaxDownloads}
                onChange={(e) => setEditMaxDownloads(e.target.value)}
                style={{ height: 40, borderRadius: 6, border: '1px solid #cbd5e1', padding: '0 10px', fontSize: 13 }}
              >
                <option value="keep">Keep Current Limit</option>
                <option value="5">5 Downloads</option>
                <option value="10">10 Downloads</option>
                <option value="25">25 Downloads</option>
                <option value="100">100 Downloads</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="edit-pw">Update / Set Password</label>
              <input
                id="edit-pw"
                type="password"
                placeholder="Leave blank to keep existing password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn-outline" onClick={() => setEditingShare(null)}>
                Cancel
              </button>
              <button type="button" className="button" disabled={editBusy} onClick={saveEditShare}>
                {editBusy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Access Logs Modal */}
      {viewingLogs && (
        <div className="modal-backdrop" onClick={() => setViewingLogs(null)}>
          <div className="modal-box" style={{ width: 'min(100%, 650px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Access Logs: {viewingLogs.file_name}</h3>
              <button className="modal-close" onClick={() => setViewingLogs(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ maxHeight: 350, overflowY: 'auto' }}>
              {shareLogs.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {shareLogs.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        padding: 10,
                        borderRadius: 6,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <strong>{l.action}</strong>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                          IP: {l.ip_address || 'unknown'} · {l.user_agent ? l.user_agent.slice(0, 40) + '…' : 'No agent'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`badge ${l.result === 'success' ? 'badge-success' : 'badge-danger'}`}>
                          {l.result}
                        </span>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                          {new Date(l.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No access events recorded yet for this share link.</div>
              )}
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline" onClick={() => setViewingLogs(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
