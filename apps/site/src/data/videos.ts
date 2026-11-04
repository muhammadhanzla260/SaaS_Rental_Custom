/**
 * Product videos on the demo page. The .mp4 files sit next to their posters in public/video/ and
 * ship with the site (they are git-ignored; see README "Product videos").
 */
export type Video = { id: string; title: string; length: string; blurb: string; look?: string; accent: string };

export const VIDEOS: Video[] = [
  { id: 'tour-aurora', title: 'The 4-minute tour', look: 'Aurora', length: '4:20', blurb: 'From the first phone call to a paid booking: quote, e-sign, deposit and confirmation.', accent: '#7C5CFF' },
  { id: 'tour-sunrise', title: 'The 4-minute tour', look: 'Sunrise', length: '4:20', blurb: 'From the first phone call to a paid booking: quote, e-sign, deposit and confirmation.', accent: '#F06A1D' },
  { id: 'tour-lagoon', title: 'The 4-minute tour', look: 'Lagoon', length: '4:20', blurb: 'From the first phone call to a paid booking: quote, e-sign, deposit and confirmation.', accent: '#0E9F9A' },
  { id: 'training', title: 'Full training', length: '15:47', blurb: 'Every feature and workflow, step by step: products, orders, payments, crews, messaging and reports.', accent: '#2C4FE0' },
];

export const video = (id: string) => VIDEOS.find((v) => v.id === id);
