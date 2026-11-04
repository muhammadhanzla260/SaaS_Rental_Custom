// @ts-check
/**
 * The two-site rule at the edge: a return visitor to "/" goes straight to the business they
 * picked (rh_vertical cookie), without a function call. Adds Build Output API routes ahead of
 * the Vercel adapter's own. "/?choose=1" (the switcher's "Back to the start screen") skips it.
 * The start page carries an inline script that does the same on any other host.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

/** @returns {import('astro').AstroIntegration} */
export default function verticalRedirect() {
  return {
    name: 'rh-vertical-redirect',
    hooks: {
      'astro:build:done': async ({ logger }) => {
        const file = new URL('../.vercel/output/config.json', import.meta.url); // only exists after a Vercel build
        if (!existsSync(file)) return;
        const config = JSON.parse(await readFile(file, 'utf-8'));
        const routes = ['events', 'cars'].map((v) => ({
          src: '^/$',
          has: [{ type: 'cookie', key: 'rh_vertical', value: v }],
          missing: [{ type: 'query', key: 'choose' }],
          status: 307,
          headers: { Location: `/${v}`, 'Cache-Control': 'private, no-store' },
        }));
        config.routes = [...routes, ...(config.routes ?? []).filter((/** @type {any} */ r) => !(r.src === '^/$' && r.has))];
        await writeFile(file, JSON.stringify(config, null, 2));
        logger.info('added cookie redirects for /');
      },
    },
  };
}
