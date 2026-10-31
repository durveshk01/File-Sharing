'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LockKeyhole,
  ShieldCheck,
  KeyRound,
  FileCheck2,
  ArrowRight,
  Sparkles,
  Eye,
  Clock,
  Layers,
  Terminal,
  FileDown,
  Check,
  ChevronDown,
  ExternalLink,
  Cpu,
  Share2,
  Activity,
  FolderLock
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function LandingPage() {
  const router = useRouter();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  async function handleDemoLogin() {
    setDemoLoading(true);
    setDemoError('');
    try {
      const res = await fetch(`${API}/api/auth/demo`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Demo login service unavailable. Please try again or create an account.');
      }
      router.push('/dashboard');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Demo login failed');
      setDemoLoading(false);
    }
  }

  const steps = [
    {
      title: '1. Upload & Envelope Encryption',
      summary: 'Files are encrypted in-memory with AES-256-GCM using a cryptographically random 256-bit Data Encryption Key (DEK) and a unique 96-bit Nonce.',
      details: 'The raw DEK is envelope-encrypted under the master Key Encryption Key (KEK) and never saved in plaintext.'
    },
    {
      title: '2. Private Object Storage',
      summary: 'Only the ciphertext and wrapped cryptographic envelope reach storage.',
      details: 'Objects are stored under randomized high-entropy keys on local disk or private S3/MinIO buckets.'
    },
    {
      title: '3. Fine-Grained Sharing Controls',
      summary: 'Generate high-entropy revocable URLs protected by Argon2id passwords, expirations, and atomic download caps.',
      details: 'Only cryptographic SHA-256 hashes of the sharing tokens are saved in the database to prevent link harvesting.'
    },
    {
      title: '4. Authenticated Verification & Decryption',
      summary: 'Recipients verify passwords to receive a temporary 15-minute verification grant.',
      details: 'During download, the 128-bit authentication tag and SHA-256 checksum verify ciphertext integrity before streaming.'
    }
  ];

  const faqs = [
    {
      q: 'How does SecureShare protect my documents?',
      a: 'SecureShare utilizes authenticated encryption using AES-256-GCM. Each file is encrypted with a unique 256-bit Data Encryption Key (DEK) and 96-bit nonce. The DEK is then envelope-encrypted under a separate Key Encryption Key (KEK). Decryption validates a 128-bit authentication tag, immediately rejecting tampered or modified ciphertext.'
    },
    {
      q: 'Are raw sharing tokens or passwords stored in the database?',
      a: 'Never. Sharing link tokens are cryptographically random strings whose SHA-256 hashes only are stored. Share passwords and user passwords are protected with Argon2id, the state-of-the-art memory-hard password hashing algorithm.'
    },
    {
      q: 'How do expiring links and download limits work?',
      a: 'Expirations are evaluated server-side on every single request. Download limits are decremented using atomic database operations, preventing race conditions or concurrent multi-tab downloads from exceeding the quota.'
    },
    {
      q: 'Can I self-host SecureShare?',
      a: 'Yes. SecureShare is designed for zero-dependency local development via SQLite or production deployment with PostgreSQL, Docker Compose, and S3-compatible private object storage (like MinIO or AWS S3).'
    },
    {
      q: 'Is there any AI or LLM processing on my files?',
      a: 'Zero. SecureShare is a 100% deterministic, non-AI platform focused strictly on software engineering, cryptography, access control, and cybersecurity.'
    }
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#fafbfd' }}>
      {/* 1. Navbar */}
      <header className="nav">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <LockKeyhole size={18} />
          </span>
          SecureShare
        </Link>

        <nav>
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#encryption">Encryption</a>
          <a href="#comparison">Comparison</a>
          <a href="#faq">FAQ</a>
          <a href={`${API}/docs`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            API Docs <ExternalLink size={12} />
          </a>
        </nav>

        <div className="nav-actions">
          <Link href="/login" className="signin">
            Sign In
          </Link>
          <button
            onClick={handleDemoLogin}
            disabled={demoLoading}
            className="btn-demo"
            title="Instant one-click demo login without credentials"
          >
            <Sparkles size={14} />
            {demoLoading ? 'Starting…' : 'Live Demo'}
          </button>
          <Link href="/register" className="button small">
            Get Started
          </Link>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse"></span> AUTHENTICATED AES-256-GCM · PRIVACY FIRST
          </div>
          <h1>
            Share Files Securely. <br />
            <span>Without Losing Control.</span>
          </h1>
          <p>
            Protect your documents with encrypted storage, secure sharing links, customizable permissions, and complete access control.
          </p>

          {demoError && (
            <div className="auth-error" style={{ marginTop: 16 }}>
              {demoError}
            </div>
          )}

          <div className="hero-ctas">
            <button
              onClick={handleDemoLogin}
              disabled={demoLoading}
              className="button"
              style={{ background: '#10b981', boxShadow: '0 5px 14px #10b98133' }}
            >
              <Sparkles size={16} />
              {demoLoading ? 'Launching Workspace…' : 'Try Live Demo (No Signup)'}
            </button>
            <Link href="/register" className="button">
              Get Started Free <ArrowRight size={15} />
            </Link>
            <a href="#features" className="secondary">
              Explore Features
            </a>
          </div>

          <div className="proof">
            <span className="proof-icon">
              <Check size={13} />
            </span>
            <span>Argon2id Hash</span>
            <i></i>
            <span className="proof-icon">
              <Check size={13} />
            </span>
            <span>Envelope KEK</span>
            <i></i>
            <span className="proof-icon">
              <Check size={13} />
            </span>
            <span>Atomic Quotas</span>
          </div>
        </div>

        {/* Hero Interactive Visual */}
        <div className="visual">
          <div className="visual-glow"></div>
          <div className="orbit orbit-a"></div>
          <div className="orbit orbit-b"></div>

          <div className="secure-card">
            <div className="card-head">
              <div>
                <span className="micro">ENCRYPTED AT REST</span>
                <strong>Confidential_Report_Q4.pdf</strong>
              </div>
              <span className="tag">
                <span></span> AES-256-GCM
              </span>
            </div>

            <div className="file-art">
              <div className="file-sheet">
                <div className="pdf">ENCRYPTED</div>
                <div className="line long"></div>
                <div className="line"></div>
                <div className="line short"></div>
                <div className="mini-seal">
                  <ShieldCheck size={13} />
                </div>
              </div>
              <div className="scan"></div>
              <div className="scan scan-two"></div>
            </div>

            <div className="card-foot">
              <div>
                <span className="foot-label">SECURE SHARING TOKEN</span>
                <span className="link-code">secureshare.local/share/7f9a…</span>
              </div>
              <div className="copy">
                <KeyRound size={15} />
              </div>
            </div>

            <div className="card-meta">
              <span>
                <Clock size={12} /> Exp: 24 Hours
              </span>
              <span>
                <FileDown size={12} /> Limit: 5 Downloads
              </span>
              <span>
                <ShieldCheck size={12} /> Password Req.
              </span>
            </div>
          </div>

          <div className="float-note">
            <div className="note-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <b>Integrity Verified</b>
              <small>Tag match & SHA-256 confirmed</small>
            </div>
            <div className="note-check">
              <Check size={11} />
            </div>
          </div>

          <div className="tiny-lock">
            <LockKeyhole size={20} />
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="trust-strip">
        <span>SECURITY GUARANTEES</span>
        <div>
          <span>
            <Cpu size={15} /> Authenticated AEAD Encryption
          </span>
          <span>
            <KeyRound size={15} /> KEK Key Wrapping
          </span>
          <span>
            <Layers size={15} /> Zero-Knowledge Share Hashes
          </span>
          <span>
            <Activity size={15} /> Concurrency-Safe Limits
          </span>
        </div>
      </section>

      {/* 3. Security Features */}
      <section className="section" id="features">
        <div className="section-head">
          <div className="eyebrow">ENGINEERED FOR DEFENSE</div>
          <h2>Security Built Into Every Layer</h2>
          <p>
            No shortcuts, no third-party telemetry, and no unencrypted storage. Every file operation is backed by authenticated cryptography.
          </p>
        </div>

        <div className="feature-grid">
          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <ShieldCheck size={19} />
              </span>
              <span className="index">01</span>
            </div>
            <h3>AES-256-GCM AEAD</h3>
            <p>
              Provides confidentiality and integrity. Every upload generates a random 256-bit key and unique 96-bit nonce. Any ciphertext tampering causes immediate decryption failure.
            </p>
            <a href="#encryption">
              Cryptographic spec <ArrowRight size={11} />
            </a>
          </div>

          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <KeyRound size={19} />
              </span>
              <span className="index">02</span>
            </div>
            <h3>Envelope Key Wrapping</h3>
            <p>
              Data Encryption Keys (DEKs) are envelope-wrapped under a master Key Encryption Key (KEK). Secret keys are never stored plaintext or logged in server telemetry.
            </p>
            <a href="#encryption">
              Key hierarchy <ArrowRight size={11} />
            </a>
          </div>

          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <Clock size={19} />
              </span>
              <span className="index">03</span>
            </div>
            <h3>Expiring & Limited Links</h3>
            <p>
              Set expiration periods from 1 hour to 30 days and restrict maximum downloads (1, 5, 10, unlimited). Limits are enforced via concurrency-safe atomic transactions.
            </p>
            <a href="#how-it-works">
              Sharing flow <ArrowRight size={11} />
            </a>
          </div>

          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <LockKeyhole size={19} />
              </span>
              <span className="index">04</span>
            </div>
            <h3>Argon2id Protection</h3>
            <p>
              Sharing links can be password-protected with Argon2id memory-hard password verification, rate limiting, and brute-force protection.
            </p>
            <a href="#how-it-works">
              Auth mechanisms <ArrowRight size={11} />
            </a>
          </div>

          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <Activity size={19} />
              </span>
              <span className="index">05</span>
            </div>
            <h3>Comprehensive Audit Trail</h3>
            <p>
              Track link access attempts, password verifications, download events, and permission updates with detailed timestamps, IP address, and results.
            </p>
            <a href="#features">
              Audit logging <ArrowRight size={11} />
            </a>
          </div>

          <div className="feature">
            <div className="feature-top">
              <span className="feature-icon">
                <FolderLock size={19} />
              </span>
              <span className="index">06</span>
            </div>
            <h3>Granular User Permissions</h3>
            <p>
              Authorize specific collaborators by email with explicit OWNER, VIEWER, or EDITOR roles. Access control is verified server-side on every request.
            </p>
            <a href="#features">
              Access control <ArrowRight size={11} />
            </a>
          </div>
        </div>
      </section>

      {/* 4. How It Works (Visual Workflow) */}
      <section className="workflow" id="how-it-works">
        <div className="workflow-copy">
          <div className="eyebrow">STEP-BY-STEP WORKFLOW</div>
          <h2>
            Upload → Encrypt → <br />
            <span>Share → Download</span>
          </h2>
          <p>
            The sender maintains complete ownership and visibility throughout the lifecycle of every transfer.
          </p>

          <div style={{ marginTop: 28 }}>
            <button onClick={handleDemoLogin} className="button" style={{ background: '#10b981' }}>
              <Sparkles size={14} /> Try Live Demo Now
            </button>
          </div>
        </div>

        <div className="steps">
          {steps.map((st, i) => (
            <div
              key={i}
              className="step"
              style={{
                cursor: 'pointer',
                background: activeStep === i ? '#ffffff' : 'transparent',
                borderRadius: 8,
                padding: '12px 14px',
                height: 'auto',
                marginBottom: 10,
                border: activeStep === i ? '1px solid #dbeafe' : '1px solid transparent',
              }}
              onClick={() => setActiveStep(i)}
            >
              <span className="step-no">0{i + 1}</span>
              <div className={`step-icon ${activeStep === i ? 'active' : ''}`}>
                {i === 0 ? <FileCheck2 /> : i === 1 ? <Layers /> : i === 2 ? <Share2 /> : <FileDown />}
              </div>
              <div style={{ flex: 1 }}>
                <b>{st.title}</b>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>{st.summary}</p>
                {activeStep === i && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#2563eb', fontWeight: 500 }}>
                    {st.details}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Encryption Explanation */}
      <section className="section" id="encryption">
        <div className="section-head">
          <div className="eyebrow">DEEP DIVE: CRYPTOGRAPHIC DESIGN</div>
          <h2>Envelope Encryption Architecture</h2>
          <p>
            SecureShare implements authenticated envelope encryption to isolate storage, protect keys, and detect unauthorized tampering.
          </p>
        </div>

        <div style={{ maxWidth: 860, margin: '36px auto 0' }}>
          <div className="crypto-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: 12, marginBottom: 16 }}>
              <span>ENVELOPE ENCRYPTION SPECIFICATION (RFC 5116 / NIST SP 800-38D)</span>
              <code>AES-256-GCM</code>
            </div>

            <pre style={{ margin: 0, lineHeight: 1.6, overflowX: 'auto' }}>
{`1. File Upload:
   plaintext_bytes ────> [SHA-256 Checksum] ───> file_record.sha256_checksum
   
2. Key & Nonce Generation:
   data_encryption_key (DEK) = CSPRNG(32 bytes) = 256 bits
   initialization_vector (IV) = CSPRNG(12 bytes) = 96 bits unique nonce

3. Authenticated Encryption:
   ciphertext + auth_tag (16 bytes) = AES_256_GCM(DEK, IV, plaintext, AAD="secureshare:file:v1")

4. Envelope Key Wrapping:
   wrapped_dek = AES_256_GCM(KEK, wrap_nonce, DEK, AAD="secureshare:key:v1")

5. Download & Tamper Check:
   DEK = AES_256_GCM_Decrypt(KEK, wrap_nonce, wrapped_dek)
   plaintext = AES_256_GCM_Decrypt(DEK, IV, ciphertext)  # Rejects tampered bits!
   assert SHA256(plaintext) == file_record.sha256_checksum`}
            </pre>
          </div>
        </div>
      </section>

      {/* 6. Feature Comparison */}
      <section className="section" id="comparison">
        <div className="section-head">
          <div className="eyebrow">WHY SECURESHARE</div>
          <h2>Feature Comparison</h2>
          <p>
            See how SecureShare compares to consumer cloud drives and unsecured file sharing sites.
          </p>
        </div>

        <div style={{ maxWidth: 960, margin: 'auto' }}>
          <table className="compare-table">
            <thead>
              <tr>
                <th>FEATURE</th>
                <th style={{ color: '#2563eb', fontWeight: 700 }}>SECURESHARE</th>
                <th>GENERIC CLOUD STORAGE</th>
                <th>LEGACY LINK TOOLS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Authenticated Encryption</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> AES-256-GCM AEAD</span></td>
                <td><span className="badge badge-warning">Server-managed AES-CBC</span></td>
                <td><span className="badge badge-danger">Unencrypted at rest</span></td>
              </tr>
              <tr>
                <td><strong>Envelope Key Wrapping</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> Isolated KEK / DEK</span></td>
                <td><span className="badge badge-neutral">Shared Master Key</span></td>
                <td><span className="badge badge-danger">None</span></td>
              </tr>
              <tr>
                <td><strong>Hashed Sharing URLs</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> SHA-256 Hashed Tokens</span></td>
                <td><span className="badge badge-warning">Sequential / Indexable</span></td>
                <td><span className="badge badge-danger">Plaintext DB Tokens</span></td>
              </tr>
              <tr>
                <td><strong>Strict Download Quotas</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> Concurrency-safe atomic</span></td>
                <td><span className="badge badge-danger">No download limits</span></td>
                <td><span className="badge badge-warning">Soft race-condition limits</span></td>
              </tr>
              <tr>
                <td><strong>Brute-Force Protected Links</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> Argon2id + Throttling</span></td>
                <td><span className="badge badge-neutral">Standard Passwords</span></td>
                <td><span className="badge badge-danger">No password support</span></td>
              </tr>
              <tr>
                <td><strong>Granular Access Logging</strong></td>
                <td><span className="badge badge-success"><Check size={12} /> Detailed Audit Trail</span></td>
                <td><span className="badge badge-neutral">High-level activity only</span></td>
                <td><span className="badge badge-danger">None</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 7. Privacy Section */}
      <section className="privacy">
        <div className="privacy-mark">
          <ShieldCheck size={28} />
        </div>
        <div>
          <div className="eyebrow" style={{ color: '#93c5fd' }}>PRIVACY FIRST</div>
          <h2>Zero Telemetry. Complete Sovereignty.</h2>
          <p>
            Your files belong to you. SecureShare does not mine documents, profile users, inject tracking pixels, or train models on private assets. What you store stays strictly encrypted.
          </p>
        </div>
        <div className="privacy-aside">
          <div>
            <Check size={15} /> 100% Non-AI Architecture
          </div>
          <div>
            <Check size={15} /> Zero Third-Party Analytics
          </div>
          <div>
            <Check size={15} /> Instant Revocation Grants
          </div>
          <div>
            <Check size={15} /> Local & S3 Storage Isolation
          </div>
        </div>
      </section>

      {/* 8. FAQ Section */}
      <section className="faq" id="faq">
        <div className="section-head">
          <div className="eyebrow">QUESTIONS & ANSWERS</div>
          <h2>Frequently Asked Questions</h2>
        </div>

        <div className="faq-grid">
          {faqs.map((f, i) => (
            <details
              key={i}
              open={openFaq === i}
              onClick={(e) => {
                e.preventDefault();
                setOpenFaq(openFaq === i ? null : i);
              }}
            >
              <summary>
                {f.q}
                <span>{openFaq === i ? '−' : '+'}</span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 9. Closing CTA Section */}
      <section className="closing">
        <div>
          <div className="eyebrow">INSTANT WORKSPACE</div>
          <h2>Ready to experience truly secure file sharing?</h2>
          <div style={{ display: 'flex', gap: 14 }}>
            <button
              onClick={handleDemoLogin}
              disabled={demoLoading}
              className="button"
              style={{ background: '#10b981', boxShadow: '0 4px 12px #10b98133' }}
            >
              <Sparkles size={16} />
              {demoLoading ? 'Starting Demo…' : 'One-Click Live Demo'}
            </button>
            <Link href="/register" className="button">
              Create Free Account <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <div className="closing-icon">
          <span>
            <LockKeyhole size={22} />
          </span>
          <ShieldCheck size={90} />
        </div>
      </section>

      {/* 10. Footer */}
      <footer>
        <Link href="/" className="brand">
          <span className="brand-mark">
            <LockKeyhole size={14} />
          </span>
          SecureShare
        </Link>
        <span>Your Files. Your Privacy. Your Control.</span>
        <div>
          <a href={`${API}/docs`} target="_blank" rel="noreferrer">
            API Documentation
          </a>
          <a href="#features">Features</a>
          <a href="#encryption">Encryption</a>
          <Link href="/login">Sign In</Link>
          <Link href="/register">Register</Link>
        </div>
        <small>© 2026 SecureShare Platform. AES-256-GCM Authenticated Encryption.</small>
      </footer>
    </div>
  );
}
