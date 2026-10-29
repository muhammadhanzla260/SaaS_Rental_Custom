import { config } from 'dotenv';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

// One .env at the repo root serves the web app, worker and scripts.
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ['@rental/core', '@rental/db', '@rental/messaging', '@rental/payments'],
  serverExternalPackages: ['postgres'],
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default nextConfig;
