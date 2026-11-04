/** Published entries only; `astro dev` also shows drafts so writers can preview them. */
import { getCollection } from 'astro:content';

const visible = (d: { draft?: boolean }) => !d.draft || import.meta.env.DEV;

export const posts = async () =>
  (await getCollection('blog', (e) => visible(e.data))).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

export const helpArticles = async () =>
  (await getCollection('help', (e) => visible(e.data))).sort((a, b) => a.data.title.localeCompare(b.data.title));

export const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Reading time from the raw Markdown body (≈220 words a minute). */
export const minutes = (body = '') => Math.max(1, Math.round(body.split(/\s+/).length / 220));

export const TAG_COLOR: Record<string, string> = { 'Event rental': '#2C4FE0', 'Car rental': '#6D3FD6', 'Product updates': '#0B7A55' };

export const HELP_CATS: Record<'events' | 'cars', [string, string, string, string][]> = {
  events: [
    ['Getting started', 'M5 12h14M13 6l6 6-6 6', '#E6ECFF', '#233FB8'],
    ['Bookings & pricing', 'M4 5h16v15H4zM4 10h16', '#E3F5EC', '#0B6145'],
    ['Payments', 'M3 6h18v12H3zM3 10h18', '#FFF1DC', '#8A4A00'],
    ['Email & SMS', 'M3 6h18v12H3zM3 7l9 6 9-6', '#F1EAFE', '#5B2DB0'],
    ['Crews & event day', 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z', '#FCE8F1', '#9B2160'],
    ['Account & billing', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', '#F1F2EA', '#10131A'],
  ],
  cars: [
    ['Fleet & vehicles', 'M4 16v-4l2-5h12l2 5v4M4 16h16', '#F1EAFE', '#5B2DB0'],
    ['Account & billing', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', '#F1F2EA', '#10131A'],
  ],
};
