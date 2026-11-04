/** Site-wide constants and the per-vertical navigation. The nav, footer and sitemap all read from here. */

export type Vertical = 'events' | 'cars';

export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? 'https://renthatch.org').replace(/\/$/, '');
export const APP_URL = (import.meta.env.PUBLIC_APP_URL ?? 'https://app.renthatch.org').replace(/\/$/, '');
export const SIGN_UP = `${APP_URL}/register`;
export const SIGN_IN = `${APP_URL}/sign-in`;
export const BRAND = 'Rent Hatch';
export const VERTICAL_COOKIE = 'rh_vertical';

/** 24-px stroke icon paths shared by the nav, footer and pages. */
export const IC = {
  event: 'M12 3 21 20H3zM12 3v17',
  car: 'M4 16v-4l2-5h12l2 5v4M4 16h16M7 16v2M17 16v2M6.5 12h11',
  book: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  pay: 'M3 6h18v12H3zM3 10h18M7 15h4',
  auto: 'M4 6h16v12H4zM4 7l8 6 8-6',
  crew: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z',
  rep: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  brand: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z',
  id: 'M4 5h16v14H4zM9 10a2 2 0 1 0 0 .01M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 9h4M14 13h3',
  cam: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  tent: 'M3 20 12 5l9 15M8 20l4-7 4 7',
  av: 'M3 6h18v11H3zM8 21h8M12 17v4',
  van: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.5-4 6-.7z',
  key: 'M14 10a4 4 0 1 0-3.5 4L4 20.5V22h3v-2h2v-2h2l1.5-1.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.6-4.6',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  chat: 'M4 5h16v11H9l-5 4z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
} as const;

type MenuItem = { title: string; sub: string; icon: string; bg: string; fg: string; href: string };
type Link = { t: string; href: string };

const mk = (rows: [string, string, string, string, string, string][]): MenuItem[] =>
  rows.map(([title, sub, icon, bg, fg, href]) => ({ title, sub, icon, bg, fg, href }));

export type VerticalNav = {
  home: string;
  label: string;
  icon: string;
  chipBg: string;
  chipFg: string;
  product: MenuItem[];
  solutionsLabel: string;
  solutions: MenuItem[];
  links: (Link & { id: string })[];
  cta: Link;
  ctaBg: string;
  ctaFg: string;
  mobile: Link[];
  footer: { tagline: string; product: Link[]; solutions: Link[]; other: Link & { color: string } };
};

export const NAV: Record<Vertical, VerticalNav> = {
  events: {
    home: '/events',
    label: 'for Events',
    icon: IC.event,
    chipBg: '#D4FF3A',
    chipFg: '#0B0D12',
    product: mk([
      ['Quotes & bookings', 'Live availability, priced to the cent.', IC.book, '#E6ECFF', '#233FB8', '/events/features#book'],
      ['Payments & deposits', 'E-sign, deposits, auto-charged balances.', IC.pay, '#E3F5EC', '#0B6145', '/events/features#pay'],
      ['Email & SMS automations', 'From your own mail server.', IC.auto, '#FFF1DC', '#8A4A00', '/events/features#auto'],
      ['Crew portal & live GPS', '5-phase checklists, heads-up texts.', IC.crew, '#FCE8F1', '#9B2160', '/events/features#crew'],
      ['Reports', '32 ready-made reports.', IC.rep, '#E0F2F7', '#0A5566', '/events/features#reports'],
      ['Your brand, everywhere', 'Logo, colours and your domain.', IC.brand, '#F1EAFE', '#5B2DB0', '/events/features#brand'],
    ]),
    solutionsLabel: 'Solutions',
    solutions: mk([
      ['Inflatables & party rental', 'Bounce houses, slides, games, concessions.', IC.event, '#E6ECFF', '#233FB8', '/events/how-it-works?gear=party'],
      ['Tents & event furniture', 'Canopies, tables, chairs, dance floors.', IC.tent, '#E3F5EC', '#0B6145', '/events/how-it-works?gear=tents'],
      ['AV, staging & lighting', 'Screens, sound, stages and lights.', IC.av, '#FFF1DC', '#8A4A00', '/events/how-it-works?gear=av'],
      ['Tools & equipment', 'Generators, lifts, construction gear.', IC.wrench, '#E0F2F7', '#0A5566', '/events/how-it-works?gear=tools'],
    ]),
    links: [
      { t: 'Pricing', href: '/events#pricing', id: 'pricing' },
      { t: 'Which setup fits?', href: '/quiz', id: 'quiz' },
    ],
    cta: { t: 'Start free trial', href: SIGN_UP },
    ctaBg: '#D4FF3A',
    ctaFg: '#0B0D12',
    mobile: [
      { t: 'Features', href: '/events/features' },
      { t: 'Event & equipment rental', href: '/events/how-it-works' },
      { t: 'Pricing', href: '/events#pricing' },
      { t: 'Which setup fits?', href: '/quiz' },
      { t: 'Switch to car rental', href: '/cars' },
      { t: 'Log in', href: SIGN_IN },
    ],
    footer: {
      tagline: 'Rental management software for party, event and equipment rental businesses.',
      product: [
        { t: 'All features', href: '/events/features' },
        { t: 'Quotes & bookings', href: '/events/features#book' },
        { t: 'Payments', href: '/events/features#pay' },
        { t: 'Automations', href: '/events/features#auto' },
        { t: 'Crew portal & GPS', href: '/events/features#crew' },
        { t: 'Reports', href: '/events/features#reports' },
        { t: 'Pricing', href: '/events#pricing' },
      ],
      solutions: [
        { t: 'Inflatables & party', href: '/events/how-it-works?gear=party' },
        { t: 'Tents & event furniture', href: '/events/how-it-works?gear=tents' },
        { t: 'AV & staging', href: '/events/how-it-works?gear=av' },
        { t: 'Tools & equipment', href: '/events/how-it-works?gear=tools' },
        { t: 'Which setup fits?', href: '/quiz' },
      ],
      other: { t: 'Rent cars instead?', href: '/cars', color: '#C9B4FF' },
    },
  },
  cars: {
    home: '/cars',
    label: 'for Cars',
    icon: IC.car,
    chipBg: '#6D3FD6',
    chipFg: '#FFFFFF',
    product: mk([
      ['Fleet calendar', 'Every vehicle and class, by the hour.', IC.book, '#F1EAFE', '#5B2DB0', '/cars#journey'],
      ['Licence & ID checks', 'Customers upload before pickup.', IC.id, '#E6ECFF', '#233FB8', '/cars#journey'],
      ['Pickup & return inspections', 'Tap-to-mark damage with photos.', IC.cam, '#FDE7E8', '#A31F25', '/cars#inspect'],
      ['Deposit holds', 'Held at pickup, released on return.', IC.pay, '#E3F5EC', '#0B6145', '/cars#rates'],
      ['Mileage, fuel & extras', 'Charged automatically at return.', IC.rep, '#FFF1DC', '#8A4A00', '/cars#rates'],
      ['Maintenance by mileage', 'Services due before they are missed.', IC.wrench, '#E0F2F7', '#0A5566', '/cars#features'],
    ]),
    solutionsLabel: 'Fleets',
    solutions: mk([
      ['Car rental', 'Economy to premium, daily and weekly.', IC.car, '#F1EAFE', '#5B2DB0', '/cars?fleet=eco#fleets'],
      ['Van & truck rental', 'Moving vans, cargo and commercial.', IC.van, '#E6ECFF', '#233FB8', '/cars?fleet=truck#fleets'],
      ['Luxury & exotic', 'High deposits, strict inspections.', IC.star, '#FFF1DC', '#8A4A00', '/cars?fleet=lux#fleets'],
      ['Long-term & subscription', 'Monthly rentals with auto-billing.', IC.key, '#E3F5EC', '#0B6145', '/cars#fleets'],
    ]),
    links: [
      { t: 'Pricing', href: '/cars#pricing', id: 'pricing' },
      { t: 'Early access', href: '/cars#access', id: 'access' },
    ],
    cta: { t: 'Get early access', href: '/cars#access' },
    ctaBg: '#6D3FD6',
    ctaFg: '#FFFFFF',
    mobile: [
      { t: 'Features', href: '/cars#features' },
      { t: 'Inspections', href: '/cars#inspect' },
      { t: 'Pricing', href: '/cars#pricing' },
      { t: 'Early access', href: '/cars#access' },
      { t: 'Switch to event rental', href: '/events' },
      { t: 'Log in', href: SIGN_IN },
    ],
    footer: {
      tagline: 'Car and vehicle rental software for fleets of every size. Now taking early-access sign-ups.',
      product: [
        { t: 'Fleet calendar', href: '/cars#features' },
        { t: 'Licence & ID checks', href: '/cars#journey' },
        { t: 'Inspections', href: '/cars#inspect' },
        { t: 'Rates & extras', href: '/cars#rates' },
        { t: 'Deposit holds', href: '/cars#rates' },
        { t: 'Maintenance', href: '/cars#features' },
        { t: 'Pricing', href: '/cars#pricing' },
      ],
      solutions: [
        { t: 'Car rental', href: '/cars?fleet=eco#fleets' },
        { t: 'Van & truck rental', href: '/cars?fleet=truck#fleets' },
        { t: 'Luxury & exotic', href: '/cars?fleet=lux#fleets' },
        { t: 'Long-term rental', href: '/cars#fleets' },
        { t: 'Early access', href: '/cars#access' },
      ],
      other: { t: 'Rent event gear instead?', href: '/events', color: '#D4FF3A' },
    },
  },
};

/** Social profiles. Empty until the owner supplies real links; the footer hides the row while empty. */
export const SOCIAL: { label: string; href: string; d: string }[] = [
  ['LinkedIn', import.meta.env.PUBLIC_SOCIAL_LINKEDIN, 'M4 9h4v11H4zM6 4.5a2 2 0 1 0 0 .01M10 9h4v1.8c.6-1 1.8-2 3.5-2C20 8.8 21 10.5 21 13v7h-4v-6c0-1.2-.5-2-1.6-2S14 12.8 14 14v6h-4z'],
  ['YouTube', import.meta.env.PUBLIC_SOCIAL_YOUTUBE, 'M3 8.5C3 6.5 4.5 5 6.5 5h11C19.5 5 21 6.5 21 8.5v7c0 2-1.5 3.5-3.5 3.5h-11C4.5 19 3 17.5 3 15.5zM10 9v6l5-3z'],
  ['Instagram', import.meta.env.PUBLIC_SOCIAL_INSTAGRAM, 'M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17 7h.01'],
  ['Facebook', import.meta.env.PUBLIC_SOCIAL_FACEBOOK, 'M14 21v-8h3l.5-3.5H14V7.5c0-1 .4-1.7 1.8-1.7H18V2.7C17.6 2.6 16.4 2.5 15 2.5c-2.9 0-4.6 1.7-4.6 4.8v2.2H7.5V13h2.9v8z'],
].filter(([, href]) => !!href).map(([label, href, d]) => ({ label: label!, href: href!, d: d! }));
