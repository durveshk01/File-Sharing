'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, Files, Gauge, KeyRound, LockKeyhole, LogOut, Settings, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import { apiRequest, clearBrowserSession } from '../lib/api';

const links = [
  { href: '/dashboard', label: 'Overview', icon: Gauge },
  { href: '/files', label: 'All files', icon: Files },
  { href: '/files/manage', label: 'Trash & shared files', icon: Trash2 },
  { href: '/shared', label: 'Sharing links', icon: Share2 },
  { href: '/access-logs', label: 'Audit trail', icon: Activity },
  { href: '/notifications', label: 'Notifications', icon: ShieldCheck },
  { href: '/security', label: 'Security & devices', icon: KeyRound },
  { href: '/settings', label: 'Settings & key backups', icon: Settings },
];

export default function WorkspaceShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState('');
  async function logout() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); clearBrowserSession(); router.replace('/'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Sign out failed. Please retry.'); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><LockKeyhole size={18} /></span>SecureShare</Link>
      <div className="side-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
        className={`side-item ${pathname === href ? 'active' : ''}`} aria-current={pathname === href ? 'page' : undefined}>
        <Icon size={16} />{label}
      </Link>)}</nav>
      <div className="side-bottom"><button className="side-item" onClick={logout} style={{ width: '100%', border: 0, background: 'none' }}><LogOut size={16} />Sign out</button></div>
    </aside>
    <main id="main-content" className="dash-main">
      <header className="dash-top"><strong>{title}</strong><div className="toolbar" style={{ margin: 0 }}>{actions}</div></header>
      <div className="dash-content">{error && <div className="notice-error" role="alert">{error}</div>}{children}</div>
    </main>
  </div>;
}
