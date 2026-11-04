// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import verticalRedirect from './integrations/vertical-redirect.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const site = process.env.PUBLIC_SITE_URL ?? 'https://renthatch.com';
// /customers is noindex until a story is approved; keep it out of the sitemap too.
const storiesDir = new URL('./src/content/stories/', import.meta.url);
const hasStories = readdirSync(storiesDir).some((f) => f.endsWith('.md') && /^approved:\s*true\s*$/m.test(readFileSync(new URL(f, storiesDir), 'utf-8')));

// Every page is prerendered to static HTML. Only /api/* runs on the server (forms).
export default defineConfig({
  site,
  output: 'static',
  // Vercel in CI/deploys; the Node adapter for local builds (the Vercel one needs symlinks Windows refuses).
  adapter: process.env.VERCEL ? vercel({ webAnalytics: { enabled: false } }) : node({ mode: 'standalone' }),
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'always' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && !page.includes('/api/') && (hasStories || !page.endsWith('/customers')) }), verticalRedirect()],
  fonts: [
    { provider: fontProviders.google(), name: 'Bricolage Grotesque', cssVariable: '--font-display', weights: ['500 800'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'],
      // The optical-size axis gives big headlines their tight, condensed look.
      options: { experimental: { variableAxis: { opsz: [['12', '96']] } } } },
    { provider: fontProviders.google(), name: 'Geist', cssVariable: '--font-ui', weights: ['400 700'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'] },
    { provider: fontProviders.google(), name: 'Geist Mono', cssVariable: '--font-mono', weights: ['400 600'], subsets: ['latin'], display: 'swap', fallbacks: ['ui-monospace', 'monospace'] },
  ],
});
