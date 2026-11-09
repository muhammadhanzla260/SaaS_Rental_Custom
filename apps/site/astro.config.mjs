// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync } from 'node:fs';

const site = process.env.PUBLIC_SITE_URL ?? 'https://renthatch.org';
// /customers is noindex until a story is approved; keep it out of the sitemap too.
const storiesDir = new URL('./src/content/stories/', import.meta.url);
const hasStories = readdirSync(storiesDir).some((f) => f.endsWith('.md') && /^approved:\s*true\s*$/m.test(readFileSync(new URL(f, storiesDir), 'utf-8')));

// Plain static files for Apache (Namecheap). Forms post to public/api/form.php; public/.htaccess
// does the clean URLs, the return-visitor redirect for "/" and caching.
export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'always' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [sitemap({ filter: (page) => !page.includes('/404') && (hasStories || !page.endsWith('/customers')) })],
  fonts: [
    { provider: fontProviders.google(), name: 'Bricolage Grotesque', cssVariable: '--font-display', weights: ['500 800'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'],
      // The optical-size axis gives big headlines their tight, condensed look.
      options: { experimental: { variableAxis: { opsz: [['12', '96']] } } } },
    { provider: fontProviders.google(), name: 'Geist', cssVariable: '--font-ui', weights: ['400 700'], subsets: ['latin'], display: 'swap', fallbacks: ['system-ui', 'sans-serif'] },
  ],
});
