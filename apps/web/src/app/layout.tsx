import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';
import { ToastProvider } from '@/components/kit';
import { MapboxTokenProvider } from '@/components/mapbox-token';
import { themeScript } from '@/lib/theme-script';
import './globals.css';

// Self-hosted at build time (no request to Google at runtime), latin subset only.
const ui = Geist({ subsets: ['latin'], variable: '--font-ui-src', display: 'swap' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display-src', weight: ['600', '700', '800'], display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono-src', weight: ['400', '500', '600'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Tentpole', template: '%s · Tentpole' },
  description: 'Bookings, deposits and reminders for event rental businesses.',
  applicationName: 'Tentpole',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F4F6' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0D12' },
  ],
};

/** Read at runtime, so a token added to .env works after a restart (no rebuild). Only public pk. tokens reach the browser. */
function publicMapboxToken(): string | null {
  const t = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  return t && t.startsWith('pk.') ? t : null;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript('light') }} />
      </head>
      <body className="min-h-dvh bg-canvas antialiased">
        <a href="#main" className="sr-only z-[200] rounded-lg bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <ToastProvider>
          <MapboxTokenProvider token={publicMapboxToken()}>{children}</MapboxTokenProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
