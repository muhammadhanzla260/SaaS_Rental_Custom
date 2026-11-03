import { config } from 'dotenv';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

// One .env at the repo root serves the web app, worker and scripts.
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

/**
 * Sent with every page. No other site may show these pages in a frame (that would let it trick someone
 * into pressing "Sign & book" or "Charge"); links to other sites carry only our origin; the coach
 * portal may ask for the location and the camera, nothing else may.
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(self "https://js.stripe.com")' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@rental/core', '@rental/db', '@rental/messaging', '@rental/payments'],
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default nextConfig;
