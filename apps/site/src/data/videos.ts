/**
 * Product videos on the demo page. The .mp4 files sit next to their posters in public/video/ and
 * ship with the site (they are git-ignored; see README "Product videos").
 */
export type Video = { id: string; title: string; length: string; blurb: string; look?: string; accent: string };

export const VIDEOS: Video[] = [
  { id: 'tour', title: 'The 4-minute tour', length: '4:02', blurb: 'From the first phone call to a paid booking: quote, e-sign, deposit and confirmation.', accent: '#7C5CFF' },
  { id: 'onboarding', title: 'Set up your business', length: '2:08', blurb: 'Sign up, then add your logo, colours, warehouse, email and team in a few minutes.', accent: '#0E9F9A' },
];

export const video = (id: string) => VIDEOS.find((v) => v.id === id);
