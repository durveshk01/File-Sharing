'use client';

import { API, API_DOCS } from './api';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  LockKeyhole,
  Smartphone,
  Server,
  Zap,
  Cloud,
  ArrowRight,
  Sparkles,
  KeyRound,
  FileCheck2,
  Check,
  ChevronDown,
  Layers,
  HardDrive,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Activity,
  Cpu,
  DownloadCloud,
  FolderLock,
  Menu
} from 'lucide-react';
import { computeSHA256, generateDEK, generateNonce, encryptFileBuffer } from './lib/crypto';
import { setBrowserAccount } from './lib/api';



export default function LandingPage() {
  const router = useRouter();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Live client-side cryptographic sandbox state
  const [testFileName, setTestFileName] = useState('confidential_brief.pdf');
  const [testPlaintext, setTestPlaintext] = useState('SecureShare: 100% processed on user device. Zero-knowledge guarantee.');
  const [cryptoResult, setCryptoResult] = useState<{
    sha256: string;
    keyBase64: string;
    nonceHex: string;
    ciphertextSample: string;
    cipherSize: number;
    timeMs: number;
  } | null>(null);
  const [encryptingLive, setEncryptingLive] = useState(false);

  async function runClientSideEncryptionDemo() {
    setEncryptingLive(true);
    const start = performance.now();
    try {
      const encoder = new TextEncoder();
      const encodedBytes = encoder.encode(testPlaintext);
      const plaintextBuffer = encodedBytes.buffer.slice(
        encodedBytes.byteOffset,
        encodedBytes.byteOffset + encodedBytes.byteLength
      ) as ArrayBuffer;
      const sha256 = await computeSHA256(plaintextBuffer);
      const { key, rawBase64 } = await generateDEK();
      const nonce = generateNonce();
      const cipherBuffer = await encryptFileBuffer(plaintextBuffer, key, nonce);
      const elapsed = Math.round((performance.now() - start) * 10) / 10;

      const cipherBytes = new Uint8Array(cipherBuffer);
      const hexSample = Array.from(cipherBytes.slice(0, 16))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      const nonceHex = Array.from(nonce)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');

      setCryptoResult({
        sha256,
        keyBase64: rawBase64,
        nonceHex,
        ciphertextSample: `${hexSample}...`,
        cipherSize: cipherBuffer.byteLength,
        timeMs: elapsed,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setEncryptingLive(false);
    }
  }

  async function handleDemoLogin() {
    setDemoLoading(true);
    setDemoError('');
    try {
      const res = await fetch(`${API}/api/auth/demo`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Demo login service unavailable. Please check the backend connection.');
      }
      const data = await res.json();
      setBrowserAccount(data);
      router.push('/dashboard');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Demo login failed');
      setDemoLoading(false);
    }
  }

  const faqs = [
    {
      q: 'Why is all file processing performed on the user device instead of Render?',
      a: 'New v2 uploads are encrypted and hashed in your browser or mobile device. Their keys stay on your device while the API coordinates authentication, metadata, and authorized ciphertext transfer. Older v1 files use server-side envelope decryption for compatibility.'
    },
    {
      q: 'How does cross-device sharing work without the server knowing the keys?',
      a: 'SecureShare encodes the file decryption key in the sharing URL fragment (e.g. #key=...). Standard browsers and HTTP stacks never transmit the URL fragment to servers. The recipient downloads the encrypted ciphertext directly and decrypts it on their device using Web Crypto.'
    },
    {
      q: 'Does SecureShare support offline mobile usage?',
      a: 'Yes! The mobile client features a local SQLite database and persistent sync queue. You can view offline files, queue uploads, rename items, and track sync status even without an active internet connection. When reconnected, changes sync with conflict detection.'
    },
    {
      q: 'Where are encrypted files stored in production?',
      a: 'SecureShare supports private S3-compatible storage (AWS S3, Cloudflare R2, or MinIO). Configured S3 uploads use short-lived signed PUTs. Downloads use scoped API streams so password protection, revocation, and download limits remain enforceable.'
    },
    {
      q: 'What cryptographic ciphers are utilized?',
      a: 'We use authenticated AES-256-GCM with 96-bit unique nonces, 128-bit authentication tags, and SHA-256 cryptographic checksums. Password hashing is secured by Argon2id.'
    }
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-primary)' }}>
      {/* 1. Header Navigation */}
      <header className="modern-nav">
        <Link href="/" className="brand-wrap">
          <div className="brand-icon-box">
            <LockKeyhole size={19} />
          </div>
          SecureShare
        </Link>

        <nav className="nav-links">
          <a href="#architecture">Architecture</a>
          <a href="#interactive-demo">Live Crypto</a>
          <a href="#features">Features</a>
          <a href="#mobile">Mobile First</a>
          <a href="#faq">FAQ</a>
          <a href={API_DOCS} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            API Docs <ExternalLink size={12} />
          </a>
        </nav>

        <details className="mobile-nav">
          <summary aria-label="Open site navigation">
            <Menu size={20} aria-hidden="true" />
          </summary>
          <nav className="mobile-nav-menu" aria-label="Mobile navigation">
            <a href="#features">Features</a>
            <a href="#architecture">Architecture</a>
            <a href="#interactive-demo">Live Crypto</a>
            <a href="#mobile">Android App</a>
            <a href="#faq">FAQ</a>
            <a href={API_DOCS} target="_blank" rel="noreferrer">API Docs</a>
          </nav>
        </details>

        <div className="nav-cta-group">
          <button className="btn-demo" onClick={handleDemoLogin} disabled={demoLoading}>
            <Sparkles size={14} />
            {demoLoading ? 'Starting Demo...' : 'Instant Demo'}
          </button>
          <Link href="/login" className="btn-secondary btn-sm">
            Sign In
          </Link>
          <Link href="/register" className="btn-primary btn-sm">
            Get Started
          </Link>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section style={{ maxWidth: 1240, margin: '0 auto', padding: '80px 24px 60px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'var(--surface-raised)', border: '1px solid var(--border)', marginBottom: 24 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Device-Powered & Zero-Knowledge Architecture
          </span>
        </div>

        <h1 style={{ fontSize: 'clamp(36px, 6vw, 68px)', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.035em', maxWidth: 960, margin: '0 auto 24px' }}>
          Your Device Encrypts.<br />
          <span style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            The Cloud Only Coordinates.
          </span>
        </h1>

        <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: 680, margin: '0 auto 36px' }}>
          Next-generation secure file management where all encryption, hashing, and decryption power comes from the user’s device. Render handles authentication, metadata, and synchronization—never plaintext files.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={handleDemoLogin} disabled={demoLoading} className="btn-primary" style={{ padding: '12px 24px', fontSize: 15 }}>
            <Sparkles size={16} /> Explore Live Interactive Workspace
          </button>
          <a href="#interactive-demo" className="btn-secondary" style={{ padding: '12px 24px', fontSize: 15 }}>
            <Zap size={16} /> Test Live Encryption
          </a>
        </div>

        {demoError && (
          <div style={{ marginTop: 16, color: '#f87171', fontSize: 13, background: 'rgba(239, 68, 68, 0.1)', padding: '8px 16px', borderRadius: 6, display: 'inline-block' }}>
            {demoError}
          </div>
        )}
      </section>

      {/* 3. Interactive Client-Side Cryptographic Sandbox */}
      <section id="interactive-demo" style={{ maxWidth: 1080, margin: '20px auto 80px', padding: '0 24px' }}>
        <div className="card" style={{ padding: '36px', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 18, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span className="badge badge-blue" style={{ marginBottom: 8 }}>LIVE CRYPTO SANDBOX</span>
              <h3 style={{ fontSize: 22, fontWeight: 700 }}>In-Browser AES-256-GCM Client Encryption</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                Test local execution: your browser generates the 256-bit key, encrypts payload, and computes SHA-256 without sending data to any server.
              </p>
            </div>
            <button
              onClick={runClientSideEncryptionDemo}
              disabled={encryptingLive}
              className="btn-primary btn-sm"
              style={{ padding: '10px 18px' }}
            >
              <Zap size={15} /> {encryptingLive ? 'Encrypting in Browser...' : 'Run Web Crypto Now'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20 }}>
            <div style={{ background: 'var(--surface-raised)', padding: 18, borderRadius: 12, border: '1px solid var(--border)' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Input Plaintext Payload
              </label>
              <textarea
                value={testPlaintext}
                onChange={(e) => setTestPlaintext(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 13,
                  fontFamily: 'DM Mono, monospace',
                  outline: 'none',
                  resize: 'none'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>File Name: <b>{testFileName}</b></span>
                <span>Size: <b>{new Blob([testPlaintext]).size} bytes</b></span>
              </div>
            </div>

            <div style={{ background: 'var(--surface-raised)', padding: 18, borderRadius: 12, border: '1px solid var(--border)' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Local Cryptographic Proof (Generated Locally)
              </label>
              {cryptoResult ? (
                <div style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Cipher: </span>
                    <span style={{ color: '#60a5fa' }}>AES-256-GCM (128-bit Tag)</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>256-bit DEK: </span>
                    <span style={{ color: '#34d399', wordBreak: 'break-all' }}>{cryptoResult.keyBase64}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>96-bit Nonce: </span>
                    <span style={{ color: '#fbbf24' }}>{cryptoResult.nonceHex}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>SHA-256: </span>
                    <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{cryptoResult.sha256}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Ciphertext: </span>
                    <span style={{ color: '#f43f5e' }}>{cryptoResult.ciphertextSample} ({cryptoResult.cipherSize} B in {cryptoResult.timeMs}ms)</span>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  Click "Run Web Crypto Now" to execute AES-256-GCM locally.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Architecture Section */}
      <section id="architecture" style={{ maxWidth: 1240, margin: '60px auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span className="badge badge-emerald" style={{ marginBottom: 12 }}>SYSTEM TOPOLOGY</span>
          <h2 style={{ fontSize: 34, fontWeight: 800 }}>The Device-Powered Cloud Model</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 640, margin: '8px auto 0' }}>
            Eliminating server bottlenecks. The heavy cryptographic computations happen on your phone or computer.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
          {/* Card 1: Client Device */}
          <div className="card" style={{ padding: 28, borderTop: '3px solid #3b82f6' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', display: 'grid', placeItems: 'center', marginBottom: 16 }}>
              <Smartphone size={22} />
            </div>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>User Device (Mobile / Web)</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Performs 100% of the heavy lifting locally:
            </p>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0 }}>
              <li>Native file reading & metadata extraction</li>
              <li>Local SHA-256 checksum calculation</li>
              <li>256-bit DEK generation & secure key storage</li>
              <li>AES-256-GCM encryption & decryption</li>
              <li>Offline SQLite storage & sync queue management</li>
            </ul>
          </div>

          {/* Card 2: Render Backend */}
          <div className="card" style={{ padding: 28, borderTop: '3px solid #10b981' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', display: 'grid', placeItems: 'center', marginBottom: 16 }}>
              <Server size={22} />
            </div>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Render Backend (Coordinator)</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Lightweight cloud orchestration and access control:
            </p>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0 }}>
              <li>Argon2id authentication & device session tokens</li>
              <li>Delta sync cursors & device state tracking</li>
              <li>Granular permissions & atomic download quotas</li>
              <li>Presigned URL upload & download authorization</li>
              <li>Never stores plaintext or raw decryption keys</li>
            </ul>
          </div>

          {/* Card 3: Cloud Object Storage */}
          <div className="card" style={{ padding: 28, borderTop: '3px solid #f59e0b' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', display: 'grid', placeItems: 'center', marginBottom: 16 }}>
              <Cloud size={22} />
            </div>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Private S3 Object Storage</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Direct encrypted transfers without app-server proxying:
            </p>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0 }}>
              <li>Direct presigned PUT/GET transfers</li>
              <li>Zero-load on Render compute instances</li>
              <li>High-durability private S3 / Cloudflare R2 storage</li>
              <li>Multipart chunking for massive encrypted files</li>
              <li>Encrypted ciphertext at rest under 64-hex object keys</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. Features Grid */}
      <section id="features" style={{ maxWidth: 1240, margin: '80px auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span className="badge badge-amber" style={{ marginBottom: 12 }}>CAPABILITIES</span>
          <h2 style={{ fontSize: 34, fontWeight: 800 }}>Engineered For Extreme Privacy</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 640, margin: '8px auto 0' }}>
            Commercial-grade features built with defense-in-depth security.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          <div className="card">
            <FolderLock size={24} style={{ color: '#60a5fa', marginBottom: 14 }} />
            <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Zero-Knowledge Share Links</h4>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Decryption keys are passed in the URL fragment (#key=...), which web browsers never transmit over HTTP to any server.
            </p>
          </div>

          <div className="card">
            <Zap size={24} style={{ color: '#34d399', marginBottom: 14 }} />
            <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Atomic Download Quotas</h4>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Conditional database locking guarantees download caps cannot be bypassed even by concurrent multi-tab download attacks.
            </p>
          </div>

          <div className="card">
            <RefreshCw size={24} style={{ color: '#fbbf24', marginBottom: 14 }} />
            <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cursor-Based Sync Feed</h4>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Mobile and desktop clients efficiently sync incremental delta changes using monotonic sync cursors, saving battery and bandwidth.
            </p>
          </div>

          <div className="card">
            <Activity size={24} style={{ color: '#fb7185', marginBottom: 14 }} />
            <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Immutable Access Auditing</h4>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Comprehensive access logs record IP address, user agent, timestamps, and failure diagnostics for every transfer.
            </p>
          </div>
        </div>
      </section>

      {/* 6. Mobile First Architecture */}
      <section id="mobile" style={{ maxWidth: 1240, margin: '80px auto', padding: '0 24px' }}>
        <div style={{ background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.4) 0%, rgba(17, 24, 39, 0.9) 100%)', border: '1px solid var(--border-subtle)', borderRadius: 20, padding: 'clamp(20px, 5vw, 48px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 36, alignItems: 'center' }}>
          <div>
            <span className="badge badge-blue" style={{ marginBottom: 12 }}>CROSS-PLATFORM MOBILE CLIENT</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 16 }}>
              Native Mobile App Powered by React Native & Expo
            </h2>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 24 }}>
              The SecureShare mobile client turns your phone into an independent cryptographic vault. Manage encrypted files, queue uploads offline, and sync seamlessly over Wi-Fi.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={18} style={{ color: '#34d399' }} /> Native Android document picker and filesystem storage
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={18} style={{ color: '#34d399' }} /> Secure hardware keychain key storage (Expo SecureStore)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={18} style={{ color: '#34d399' }} /> Persistent sync queue with Wi-Fi and battery preferences
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Check size={18} style={{ color: '#34d399' }} /> Android APK build ready with EAS / Gradle configuration
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Smartphone size={18} style={{ color: '#60a5fa' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>SecureShare Mobile Client</span>
              </div>
              <span className="badge badge-emerald">Active</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ background: 'var(--surface-raised)', padding: '10px 14px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Local Crypto Engine</span>
                <span style={{ fontWeight: 600, color: '#34d399' }}>AES-256-GCM Native</span>
              </div>
              <div style={{ background: 'var(--surface-raised)', padding: '10px 14px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Offline Sync Queue</span>
                <span style={{ fontWeight: 600, color: '#60a5fa' }}>SQLite Powered</span>
              </div>
              <div style={{ background: 'var(--surface-raised)', padding: '10px 14px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Key Envelope Storage</span>
                <span style={{ fontWeight: 600, color: '#fbbf24' }}>Android Keystore</span>
              </div>
              <div style={{ background: 'var(--surface-raised)', padding: '10px 14px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Transfer Route</span>
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>Direct Presigned S3/R2</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FAQ */}
      <section id="faq" style={{ maxWidth: 840, margin: '80px auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <span className="badge badge-blue" style={{ marginBottom: 12 }}>FAQ</span>
          <h2 style={{ fontSize: 32, fontWeight: 800 }}>Frequently Asked Questions</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {faqs.map((f, i) => (
            <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%',
                  padding: '18px 20px',
                  background: 'none',
                  border: 0,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span>{f.q}</span>
                <ChevronDown
                  size={18}
                  style={{
                    color: 'var(--text-muted)',
                    transform: openFaq === i ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease'
                  }}
                />
              </button>
              {openFaq === i && (
                <div style={{ padding: '0 20px 20px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 8. Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '40px 24px', background: 'var(--surface)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          <div className="brand-wrap">
            <div className="brand-icon-box" style={{ width: 28, height: 28 }}>
              <LockKeyhole size={15} />
            </div>
            <span style={{ fontSize: 16 }}>SecureShare</span>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Device-Powered Encrypted Cloud Synchronization. No AI, No Plaintext at Rest.
          </div>

          <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-secondary)' }}>
            <Link href="/login">Sign In</Link>
            <Link href="/register">Register</Link>
            <a href={`${API}/docs`} target="_blank" rel="noreferrer">API Documentation</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
