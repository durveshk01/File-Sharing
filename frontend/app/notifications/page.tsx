'use client';

import { API } from '../api';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  LockKeyhole,
  Gauge,
  Files,
  Share2,
  Activity,
  KeyRound,
  Settings,
  LogOut,
  Check,
  CheckCheck,
  Bell
} from 'lucide-react';



type NotificationItem = {
  id: string;
  message: string;
  read: boolean;
  created_at: string;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const router = useRouter();

  async function load() {
    setError('');
    try {
      const r = await fetch(`${API}/api/notifications`, { credentials: 'include' });
      if (r.status === 401) {
        router.replace('/login');
        return;
      }
      if (!r.ok) throw new Error('Could not load notifications. Try again.');
      setItems(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notifications. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function mark(id: string) {
    setSavingId(id);
    setError('');
    try {
      const response = await fetch(`${API}/api/notifications/${id}`, { method: 'PATCH', credentials: 'include' });
      if (!response.ok) throw new Error('Could not update this notification. Try again.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this notification. Try again.');
    } finally {
      setSavingId(null);
    }
  }

  async function markAllRead() {
    setSavingAll(true);
    setError('');
    try {
      const response = await fetch(`${API}/api/notifications/mark-all-read`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Could not update notifications. Try again.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update notifications. Try again.');
    } finally {
      setSavingAll(false);
    }
  }

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  const unreadCount = items.filter((n) => !n.read).length;

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
        <Link className="side-item" href="/access-logs">
          <Activity size={16} /> Audit Logs
        </Link>
        <Link className="side-item active" href="/notifications">
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
          <strong>Notifications Center</strong>
          <span>{unreadCount} unread security and sharing updates</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Notifications</h1>
              <p>In-app alerts for uploads, recipient downloads, password challenges, and expirations.</p>
            </div>
            {unreadCount > 0 && (
              <button className="btn-outline" onClick={markAllRead} disabled={savingAll}>
                <CheckCheck size={15} /> {savingAll ? 'Updating…' : 'Mark All as Read'}
              </button>
            )}
          </div>

          <div className="panel" style={{ maxWidth: 800 }}>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {loading ? (
              <div className="empty">Loading notifications…</div>
            ) : items.length ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {items.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      background: n.read ? '#fff' : '#f0f7ff',
                      border: n.read ? '1px solid #e2e8f0' : '1px solid #bfdbfe',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: n.read ? '#f1f5f9' : '#dbeafe',
                          color: n.read ? '#64748b' : '#2563eb',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <Bell size={15} />
                      </span>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: '#0f172a' }}>
                          {n.message}
                        </span>
                        <small style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginTop: 3 }}>
                          {new Date(n.created_at).toLocaleString()}
                        </small>
                      </div>
                    </div>

                    {!n.read && (
                      <button
                        onClick={() => mark(n.id)}
                        className="btn-outline btn-sm"
                        disabled={savingId === n.id || savingAll}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        <Check size={12} /> {savingId === n.id ? 'Updating…' : 'Mark Read'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <Bell size={32} style={{ margin: 'auto', marginBottom: 10, color: '#94a3b8' }} />
                <p>You&apos;re all caught up. No notifications right now.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
