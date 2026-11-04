// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import verticalRedirect from './integrations/vertical-redirect.mjs';

const site = process.env.PUBLIC_SITE_URL ?? 'https://renthatch.com';

// Every page is prerendered to static HTML. Only /api/* runs on the server (forms).
export default defineConfig({
  site,
  output: 'static',
  // Vercel in CI/deploys; the Node adapter for local builds (the Vercel one needs symlinks Windows refuses).
  adapter: process.env.VERCEL ? vercel({ webAnalytics: { enabled: false } }) : node({ mode: 'standalone' }),
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && !page.includes('/api/') }), verticalRedirect()],
  fonts: [
    { provider: fontProviders.google(), name: 'Bricolage Grotesque', cssVariable: '--font-display', weights: ['500 800'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'],
      // The optical-size axis gives big headlines their tight, condensed look.
      options: { experimental: { variableAxis: { opsz: [['12', '96']] } } } },
    { provider: fontProviders.google(), name: 'Geist', cssVariable: '--font-ui', weights: ['400 700'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'] },
    { provider: fontProviders.google(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 600'], subsets: ['latin'], display: 'swap', fallbacks: ['ui-monospace', 'monospace'] },
  ],
});
