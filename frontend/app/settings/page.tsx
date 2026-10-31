'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Settings,
  LockKeyhole,
  Gauge,
  Files,
  Share2,
  Activity,
  ShieldCheck,
  KeyRound,
  LogOut,
  User,
  Mail,
  HardDrive,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const fmt = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

export default function SettingsPage() {
  const [user, setUser] = useState<{ id: string; name: string; email: string; verified?: boolean } | null>(null);
  const [storageUsage, setStorageUsage] = useState<{ bytes: number; limit: number } | null>(null);
  const router = useRouter();

  async function load() {
    try {
      const [uRes, sRes] = await Promise.all([
        fetch(`${API}/api/auth/me`, { credentials: 'include' }),
        fetch(`${API}/api/storage/usage`, { credentials: 'include' }),
      ]);
      if (uRes.status === 401) {
        router.replace('/login');
        return;
      }
      if (uRes.ok) setUser(await uRes.json());
      if (sRes.ok) setStorageUsage(await sRes.json());
    } catch {
      // Handled silently
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/');
  }

  const used = storageUsage?.bytes || 0;
  const limit = storageUsage?.limit || 52428800; // 50MB
  const percent = Math.min(100, Math.round((used / limit) * 100));

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
        <Link className="side-item" href="/notifications">
          <ShieldCheck size={16} /> Notifications
        </Link>

        <div className="side-label">ACCOUNT</div>
        <Link className="side-item" href="/security">
          <KeyRound size={16} /> Security & 2FA
        </Link>
        <Link className="side-item active" href="/settings">
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
          <strong>Account & Workspace Settings</strong>
          <span>Profile configuration</span>
        </header>

        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <h1>Settings & Preferences</h1>
              <p>Manage your account profile, storage quotas, and security configuration.</p>
            </div>
          </div>

          <div style={{ maxWidth: 800, display: 'grid', gap: 20 }}>
            {/* User Profile Card */}
            <div className="panel">
              <div className="panel-title">
                <h3>User Profile</h3>
                <span className="badge badge-success">
                  <CheckCircle2 size={12} /> Active Account
                </span>
              </div>

              <div style={{ display: 'grid', gap: 14, fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e0e7ff', color: '#4338ca', display: 'grid', placeItems: 'center' }}>
                    <User size={20} />
                  </div>
                  <div>
                    <strong style={{ fontSize: 16, color: '#0f172a' }}>{user?.name || 'Loading…'}</strong>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{user?.email}</div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 14, marginTop: 4, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Account Identifier:</span>
                    <code style={{ color: '#0f172a', fontSize: 11 }}>{user?.id}</code>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Password Hash:</span>
                    <span>Argon2id (Memory-hard)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Storage Quota Panel */}
            <div className="panel">
              <div className="panel-title">
                <h3>Storage & Object Allocation</h3>
                <HardDrive size={16} color="#2563eb" />
              </div>

              <div style={{ fontSize: 13, color: '#475569' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>{fmt(used)} used of {fmt(limit)}</span>
                  <strong>{percent}%</strong>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
                </div>
                <small style={{ color: '#94a3b8', fontSize: 11 }}>
                  Files are compressed and encrypted with AES-256-GCM before writing to storage.
                </small>
              </div>
            </div>

            {/* Quick Links to Security & Sessions */}
            <div className="panel">
              <div className="panel-title">
                <h3>Security & Access</h3>
                <KeyRound size={16} color="#2563eb" />
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                <Link
                  href="/security"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>Two-Factor Authentication & Active Sessions</strong>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>
                      Configure TOTP authenticator apps, view device sessions, and change passwords.
                    </p>
                  </div>
                  <span style={{ color: '#2563eb', fontSize: 12, fontWeight: 600 }}>Manage →</span>
                </Link>

                <Link
                  href="/access-logs"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: 8,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>Audit & Telemetry Logs</strong>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>
                      Review complete access logs for file uploads, downloads, and link events.
                    </p>
                  </div>
                  <span style={{ color: '#2563eb', fontSize: 12, fontWeight: 600 }}>View Logs →</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
