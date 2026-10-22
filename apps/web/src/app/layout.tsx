import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { MapboxTokenProvider } from '@/components/mapbox-token';
import { MotionProvider } from '@/components/motion';
import { themeScript } from '@/lib/theme-script';
import './globals.css';

const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const heading = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-heading', weight: ['600', '700'], display: 'swap' });
const code = JetBrains_Mono({ subsets: ['latin'], variable: '--font-code', weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Rental Custom', template: '%s · Rental Custom' },
  description: 'Bookings, inventory, quotes, deposits and invoices for rental businesses.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1016' },
  ],
};

/** Read at runtime, so a token added to .env works after a restart (no rebuild). Only public pk. tokens reach the browser. */
function publicMapboxToken(): string | null {
  const t = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  return t && t.startsWith('pk.') ? t : null;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body className="bg-canvas min-h-dvh antialiased">
        <MotionProvider>
          <MapboxTokenProvider token={publicMapboxToken()}>{children}</MapboxTokenProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
