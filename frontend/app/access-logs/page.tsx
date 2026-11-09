'use client';

import { API } from '../api';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  LockKeyhole,
  Gauge,
  Files,
  Share2,
  ShieldCheck,
  KeyRound,
  Settings,
  LogOut,
  ArrowDownToLine,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';



type LogEntry = {
  id: string;
  file_id: string | null;
  share_id: string | null;
  action: string;
  result: string;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function AccessLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [search, setSearch] = useState('');
  const router = useRouter();

  async function load() {
    try {
      const r = await fetch(`${API}/api/access-logs`, { credentials: 'include' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      if (r.ok) {
        setLogs(await r.json());
      } else {
        setError('Could not load access logs');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  const filteredLogs = logs.filter((l) => {
    const matchesAction = filterAction === 'all' || l.action.toLowerCase().includes(filterAction);
    const matchesSearch =
      search === '' ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      (l.ip_address && l.ip_address.includes(search)) ||
      (l.failure_reason && l.failure_reason.toLowerCase().includes(search.toLowerCase()));
    return matchesAction && matchesSearch;
  });

  const totalEvents = logs.length;
  const successfulDownloads = logs.filter((l) => l.action.includes('download') && l.result === 'success').length;
  const failedAttempts = logs.filter((l) => l.result === 'denied' || l.result === 'failure').length;

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
        <Link className="side-item" href="/shared">
          <Share2 size={16} /> Sharing Links
        </Link>
        <Link className="side-item active" href="/access-logs">
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
          <strong>Security Audit Trails</strong>
          <span>Real-time access logging & telemetry</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Audit & Access Logs</h1>
              <p>Full immutable record of file uploads, share link access, password challenges, and downloads.</p>
            </div>
          </div>

          {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

          {/* Metric Cards */}
          <div className="stats" style={{ marginBottom: 20 }}>
            <div className="stat">
              <div className="stat-head">
                Total Audit Events
                <span className="stat-icon">
                  <Activity size={15} />
                </span>
              </div>
              <strong>{totalEvents}</strong>
              <small>Recorded events</small>
            </div>

            <div className="stat">
              <div className="stat-head">
                Successful Downloads
                <span className="stat-icon">
                  <ArrowDownToLine size={15} />
                </span>
              </div>
              <strong>{successfulDownloads}</strong>
              <small>Completed transfers</small>
            </div>

            <div className="stat">
              <div className="stat-head">
                Denied / Failed Attempts
                <span className="stat-icon" style={{ color: '#ef4444', background: '#fee2e2' }}>
                  <AlertTriangle size={15} />
                </span>
              </div>
              <strong style={{ color: failedAttempts > 0 ? '#ef4444' : 'inherit' }}>{failedAttempts}</strong>
              <small>Blocked or failed requests</small>
            </div>

            <div className="stat">
              <div className="stat-head">
                Audit Visibility
                <span className="stat-icon" style={{ color: '#10b981', background: '#d1fae5' }}>
                  <ShieldCheck size={15} />
                </span>
              </div>
              <strong style={{ color: '#34d399' }}>Scoped</strong>
              <small>Owner-authorized access history</small>
            </div>
          </div>

          {/* Search & Action Filters */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'All Events', value: 'all' },
                { label: 'Downloads', value: 'download' },
                { label: 'Shares', value: 'share' },
                { label: 'Uploads', value: 'upload' },
                { label: 'Denied / Failed', value: 'denied' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilterAction(opt.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    border: '1px solid #cbd5e1',
                    background: filterAction === opt.value ? '#2563eb' : 'var(--surface-raised)',
                    color: filterAction === opt.value ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search IP, action, reason…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 32px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  outline: 'none',
                  background: 'var(--surface-raised)',
                }}
              />
            </div>
          </div>

          {/* Logs Table */}
          <div className="panel table-scroll">
            {loading ? (
              <div className="empty">Loading access logs…</div>
            ) : filteredLogs.length ? (
              <table className="files-table">
                <thead>
                  <tr>
                    <th>EVENT ACTION</th>
                    <th>RESULT</th>
                    <th>IP ADDRESS</th>
                    <th>CLIENT DETAILS</th>
                    <th>TIMESTAMP</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div>
                          <span>{l.action}</span>
                          {l.failure_reason && (
                            <small style={{ display: 'block', color: '#dc2626', fontSize: 10 }}>
                              Reason: {l.failure_reason}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            l.result === 'success'
                              ? 'badge-success'
                              : l.result === 'denied'
                              ? 'badge-warning'
                              : 'badge-danger'
                          }`}
                        >
                          {l.result}
                        </span>
                      </td>
                      <td>
                        <code style={{ fontSize: 11, color: '#475569' }}>{l.ip_address || 'unknown'}</code>
                      </td>
                      <td>
                        <span style={{ fontSize: 10, color: '#64748b' }}>
                          {l.user_agent ? l.user_agent.slice(0, 45) + '…' : 'Internal / Unknown'}
                        </span>
                      </td>
                      <td>{new Date(l.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">No audit log entries matching your filter criteria.</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
