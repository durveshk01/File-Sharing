import './globals.css';
import WorkspaceNavigation from './components/workspace-navigation';

export const metadata = {
  title: 'SecureShare — Secure File Sharing & Encrypted Document Transfer',
  description: 'Your Files. Your Privacy. Your Control. Protect documents with AES-256-GCM authenticated encryption, revocable links, granular permissions, and zero-knowledge sharing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body><WorkspaceNavigation />{children}</body>
    </html>
  );
}
