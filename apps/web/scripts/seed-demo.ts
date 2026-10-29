/**
 * Demo data for previewing and QA (local or staging only, never production):
 * the platform owner, Freedom Fun USA (demo) with 4 branches, a full team,
 * catalog, customers and orders, plus five more organizations in every
 * console status. Safe to rerun: the previous demo data is removed first.
 *
 *   pnpm seed:demo
 * Every login uses the password printed at the end.
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import {
  bookingDefaultsSchema, brandSettingsSchema, customerSchema, locationSchema, orderSchema, parsePreferences, productSchema, wallTimeToUtc,
} from '@rental/core';
import {
  acceptInvitation, createCategory, createCustomer, createDb, createInvitation, createLocation, createOrder, createProduct, createWorkspace,
  launchWorkspace, listLocations, markOnboarding, platformCloseOrg, platformSetStatus, saveConnectStep, setupOrganization, transitionOrder,
  updateBrand, updateMember, updatePreferences, listTeam,
} from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
if (process.env.NODE_ENV === 'production' || /neon\.tech/.test(process.env.DATABASE_URL_OWNER ?? '') && !process.env.ALLOW_DEMO_SEED) {
  console.error('Refusing to seed demo data here. Set ALLOW_DEMO_SEED=1 for a staging database.');
  process.exit(1);
}

const PASSWORD = 'Tentpole-2026!';
const DOMAIN = 'demo.tentpole.test';
// Services run on the restricted app connection (row-level security on), exactly like the app.
// The owner connection only creates logins, flags the platform owner and clears old demo data.
const { db } = createDb(process.env.DATABASE_URL!, { max: 4 });
const { client } = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const appClient = createDb(process.env.DATABASE_URL!, { max: 1 }).client;

const SLUGS = ['freedom-fun-demo', 'summit-tent', 'lakeside-party-rentals', 'bayou-bounce', 'northwind-av', 'old-town-inflatables'];

async function reset() {
  // Leftovers from browser QA runs (e2e-*.mjs): orgs named <name>-<timestamp> and their logins.
  const qa = ['^freedom-fun-demo-[a-z0-9]{8}$', '^party-rentals-[a-z0-9]{8}$', '^lakeside-[a-z0-9]{5}$', '^summit-tent-[a-z0-9]{5}$', '^bayou-bounce-[a-z0-9]{5}$', '^lakeside-party-rentals-[a-z0-9]{5}$'];
  await client`delete from audit_log where tenant_id in (select id from tenants where slug ~ any(${qa}))`;
  await client`delete from tenants where slug ~ any(${qa})`;
  await client`delete from released_slugs where slug ~ any(${qa})`;
  await client`delete from users where email ~ '@(lakeside|tentpole|bayou)\.test$' or email ~ '^(owner|crew|orders)-[a-z0-9]{8}@example\.test$'`;
  await client`delete from audit_log where tenant_id in (select id from tenants where slug = any(${SLUGS}))`;
  await client`delete from tenants where slug = any(${SLUGS})`;
  await client`delete from released_slugs where slug = any(${SLUGS})`;
  await client`delete from users where email like ${'%@' + DOMAIN}`;
}

const hash = await hashPassword(PASSWORD);
async function user(local: string, name: string, platformAdmin = false) {
  const id = randomUUID();
  const email = `${local}@${DOMAIN}`;
  await client`insert into users (id, name, email, email_verified, is_platform_admin) values (${id}, ${name}, ${email}, true, ${platformAdmin})`;
  await client`insert into accounts (id, account_id, provider_id, user_id, password) values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash})`;
  return { id, email, name };
}

const loc = (name: string, code: string, line1: string, city: string, region: string, postalCode: string, lat: number, lng: number, pillColor: string, extra: object = {}) =>
  locationSchema.parse({
    name, code, phone: '(512) 555-0100', address: { line1, city, region, postalCode, country: 'US', lat, lng },
    settings: { pillColor, servedZips: [], ...extra },
  });

async function main() {
  await reset();
  const actorOf = (u: { id: string }) => ({ type: 'user' as const, userId: u.id });

  // --- people ---------------------------------------------------------------------------
  const platform = await user('owner', 'Muhammad Hanzla', true);
  const jordan = await user('jordan', 'Jordan Reyes');
  const staff = {
    alex: await user('alex', 'Alex Kim'),
    priya: await user('priya', 'Priya Nair'),
    sam: await user('sam', 'Sam Ortiz'),
    chris: await user('chris', 'Chris Doyle'),
    morgan: await user('morgan', 'Morgan Lee'),
    riley: await user('riley', 'Riley Chen'),
    kai: await user('kai', 'Kai Jensen'),
  };

  // --- Freedom Fun USA (demo): the design's tenant ---------------------------------------
  const ff = await setupOrganization(db, { userId: jordan.id }, {
    slug: 'freedom-fun-demo', name: 'Freedom Fun USA',
    location: loc('Austin', 'AUS', '9600 Great Hills Trail', 'Austin', 'TX', '78759', 30.3946, -97.7467, '#0B0D12', { servedZips: ['78701', '78702', '78703', '78704', '78759'] }),
    taxPercent: 8.25,
    booking: bookingDefaultsSchema.parse({ depositPercent: 30, cleanupBufferMinutes: 180, damageWaiverPercent: 10, freeTravelDistance: 10 }),
  });
  const ffActor = actorOf(jordan);
  await client`update tenants set legal_name = 'Freedom Fun USA LLC', phone = '+15129815557', email = 'bookings@freedomfunusa.test',
    website = 'https://freedomfunusa.com', status = 'active', plan = 'scale', rollout_phase = 1 where id = ${ff.id}`;
  await updateBrand(db, ff.id, ffActor, {
    branding: { brandColor: '#C2410C', themeMode: 'light', radius: 'round' },
    brand: brandSettingsSchema.parse({ sidebar: 'dark', headingFont: 'friendly', reviewLink: 'https://g.page/r/freedomfun', invoiceFooter: 'Thank you for choosing Freedom Fun USA! Deposits are non-refundable within 7 days of the event; weather cancellations become a rain check valid for 12 months.' }),
  });
  for (const step of ['profile', 'brand', 'warehouse', 'connect', 'team', 'launch'] as const) await markOnboarding(db, ff.id, step, 'done', 5);
  await saveConnectStep(db, ff.id, ffActor, {
    mail: { mode: 'smtp', provider: 'google', host: 'smtp.gmail.com', port: 587, security: 'starttls', username: 'bookings@freedomfunusa.test', password: 'demo-app-password', fromName: 'Freedom Fun USA', fromEmail: 'bookings@freedomfunusa.test' },
    sms: { provider: 'quo', sendingNumber: '+15129815557', apiKey: 'demo-quo-key' },
    payments: { provider: 'ipos', merchantId: '220614981234', secretKey: 'demo-ipos-token' },
  });
  await updatePreferences(db, ff.id, ffActor, 'setupDone', ['numbers', 'rules']);

  const dal = await createLocation(db, ff.id, ffActor, loc('Dallas', 'DAL', '2200 Ross Ave', 'Dallas', 'TX', '75201', 32.7887, -96.7997, '#2C4FE0'), 8.25);
  const hou = await createLocation(db, ff.id, ffActor, loc('Houston', 'HOU', '1001 Avenida de las Americas', 'Houston', 'TX', '77010', 29.7522, -95.3586, '#0B7A55'), 8.25);
  const phx = await createLocation(db, ff.id, ffActor, loc('Phoenix', 'PHX', '100 N 3rd St', 'Phoenix', 'AZ', '85004', 33.4486, -112.0703, '#A85A00', { paused: true }), 8.6);
  const aus = (await listLocations(db, ff.id)).find((l) => l.code === 'AUS')!;

  // Team: every role, with branches and commission like the design's Team screen.
  const join = async (u: { id: string; email: string; name: string }, role: Parameters<typeof createInvitation>[3]['role'], extra: Partial<Parameters<typeof createInvitation>[3]> = {}) => {
    const { token } = await createInvitation(db, ff.id, ffActor, { email: u.email, name: u.name, role, ...extra });
    await acceptInvitation(db, token, { id: u.id, email: u.email });
  };
  await join(staff.alex, 'admin');
  await join(staff.priya, 'manager', { locationIds: [aus.id, dal.id] });
  await join(staff.sam, 'sales', { locationIds: [aus.id], commissionPct: 5 });
  await join(staff.chris, 'coach', { locationIds: [aus.id], vehicle: 'Van 2 · white Transit' });
  await join(staff.kai, 'crew', { locationIds: [aus.id] });
  await join(staff.morgan, 'accountant');
  await join(staff.riley, 'viewer', { locationIds: [phx.id] });
  await createInvitation(db, ff.id, ffActor, { email: `taylor@${DOMAIN}`, name: 'Taylor Brooks', role: 'sales', locationIds: [hou.id], commissionPct: 5 });
  const riley = (await listTeam(db, ff.id)).members.find((m) => m.email === staff.riley.email)!;
  await updateMember(db, ff.id, { ...ffActor, role: 'owner' }, riley.id, { status: 'disabled' });

  // Catalog (prices from the FreedomFun Odoo catalog style: base hours + hourly or $25/15 min overtime).
  const inflatables = await createCategory(db, ff.id, ffActor, 'Inflatables');
  const concessions = await createCategory(db, ff.id, ffActor, 'Concessions');
  const games = await createCategory(db, ff.id, ffActor, 'Games & activities');
  const screens = await createCategory(db, ff.id, ffActor, 'Movie screens');
  const product = (name: string, categoryId: string, priceStaffed: number, inv: Record<string, number>, extra: object = {}) =>
    createProduct(db, ff.id, ffActor, productSchema.parse({ name, categoryId, priceStaffed, inventory: inv, baseHours: 4, ...extra }));
  const castle = await product('Castle Bounce House', inflatables.id, 225, { [aus.id]: 2, [dal.id]: 1 }, { pricePickup: 175, priceDropoff: 199 });
  const slide = await product('Tropical Water Slide', inflatables.id, 349, { [aus.id]: 1, [hou.id]: 1 }, { priceDropoff: 299, hourlyRate: 50 });
  const popcorn = await product('Popcorn Machine', concessions.id, 75, { [aus.id]: 3 }, { pricePickup: 45, kind: 'addon' });
  const cotton = await product('Cotton Candy Machine', concessions.id, 85, { [aus.id]: 2 }, { pricePickup: 55, kind: 'addon' });
  const laser = await product('Laser Tag Arena (10 players)', games.id, 499, { [aus.id]: 1, [dal.id]: 1 }, { hourlyRate: 100 });
  const screen = await product('40 ft Outdoor Movie Screen', screens.id, 650, { [aus.id]: 1 }, { baseHours: 5 });

  // Customers
  const customer = (firstName: string, lastName: string, phone: string, city: string, source: string, extra: object = {}) =>
    createCustomer(db, ff.id, ffActor, customerSchema.parse({ firstName, lastName, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`, phone, address: { line1: '1100 Congress Ave', city, region: 'TX', postalCode: '78701', country: 'US', lat: 30.2747, lng: -97.7404 }, source, ...extra }));
  const maria = await customer('Maria', 'Gonzalez', '512-555-0101', 'Cedar Park', 'Google search');
  const devon = await customer('Devon', 'Price', '512-555-0102', 'Round Rock', 'Repeat customer');
  const aisha = await customer('Aisha', 'Khan', '512-555-0103', 'Austin', 'Referral');
  const school = await createCustomer(db, ff.id, ffActor, customerSchema.parse({ kind: 'organization', companyName: 'Hill Country Elementary PTA', email: 'pta@hillcountry.test', phone: '512-555-0110', address: { line1: '4500 Spicewood Springs Rd', city: 'Austin', region: 'TX', postalCode: '78759', country: 'US', lat: 30.3712, lng: -97.7598 }, source: 'Referral' }));

  // Orders over the next weeks: booked, quotes and drafts (Austin wall time).
  const prefs = parsePreferences((await client`select settings from tenants where id = ${ff.id}`)[0]!.settings);
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  const order = async (c: { id: string }, date: string, from: string, to: string, lines: { productId: string; quantity?: number; serviceMode?: string }[], action: 'book' | 'send_quote' | null, extra: object = {}) => {
    const o = await createOrder(db, ff.id, ffActor, orderSchema.parse({
      customerId: c.id, locationId: aus.id, eventType: 'Birthday',
      startsAt: wallTimeToUtc(date, from, 'America/Chicago'), endsAt: wallTimeToUtc(date, to, 'America/Chicago'),
      eventAddress: { line1: '1100 Congress Ave', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', lat: 30.2747, lng: -97.7404 },
      eventContactName: 'On-site contact', eventContactMobile: '512-555-0199',
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity ?? 1, serviceMode: l.serviceMode ?? 'staffed' })),
      travelFee: 21, ...extra,
    }), prefs);
    if (action) await transitionOrder(db, ff.id, ffActor, o.id, action, prefs);
    return o;
  };
  await order(maria, day(4), '13:00', '18:00', [{ productId: castle.id }, { productId: popcorn.id }], 'book');
  await order(devon, day(4), '14:00', '19:00', [{ productId: castle.id }, { productId: cotton.id }], 'book');
  await order(school, day(9), '09:00', '15:00', [{ productId: laser.id }, { productId: slide.id }, { productId: popcorn.id, quantity: 2 }], 'book', { eventType: 'School or church' });
  await order(aisha, day(11), '18:30', '22:30', [{ productId: screen.id }, { productId: popcorn.id }], 'send_quote', { eventType: 'Movie night' });
  await order(devon, day(18), '12:00', '16:00', [{ productId: slide.id, serviceMode: 'dropoff' }], 'send_quote');
  await order(maria, day(25), '15:00', '19:00', [{ productId: castle.id, serviceMode: 'pickup' }], null);
  await order(aisha, day(2), '10:00', '14:00', [{ productId: laser.id }], 'book', { eventType: 'Company or team' });

  // --- other organizations for the console: every status ----------------------------------
  const other = async (local: string, name: string, slug: string, status: 'active' | 'trial', plan: 'starter' | 'growth' | 'scale', progress: number) => {
    const u = await user(local, name.split(' ')[0] + ' Owner');
    const t = await createWorkspace(db, { userId: u.id }, { name, slug, country: 'US', plan, status });
    const steps = ['profile', 'brand', 'warehouse', 'connect', 'team', 'launch'] as const;
    for (const s of steps.slice(0, progress)) await markOnboarding(db, t.id, s, 'done', Math.min(5, progress));
    if (progress >= 6) await launchWorkspace(db, t.id, actorOf(u), plan);
    return t;
  };
  await other('avery', 'Summit Tent & Event', 'summit-tent', 'active', 'growth', 6);
  await other('jordanr', 'Lakeside Party Rentals', 'lakeside-party-rentals', 'trial', 'growth', 5);
  const bayou = await other('casey', 'Bayou Bounce Co.', 'bayou-bounce', 'active', 'starter', 6);
  await client`update tenants set status = 'past_due' where id = ${bayou.id}`;
  const northwind = await other('drew', 'Northwind AV Rentals', 'northwind-av', 'trial', 'growth', 4);
  await platformSetStatus(db, platform.id, northwind.id, 'suspended');
  const oldTown = await other('robin', 'Old Town Inflatables', 'old-town-inflatables', 'trial', 'starter', 1);
  await platformCloseOrg(db, platform.id, oldTown.id, 'old-town-inflatables');

  console.log(`
Demo data ready. Password for every login: ${PASSWORD}

  Platform owner (console)  ${platform.email}
  Freedom Fun owner         ${jordan.email}       → /freedom-fun-demo
  Admin                     ${staff.alex.email}
  Manager (AUS, DAL)        ${staff.priya.email}
  Sales (AUS, 5%)           ${staff.sam.email}
  Coach                     ${staff.chris.email}
  Accountant                ${staff.morgan.email}
  Viewer (disabled)         ${staff.riley.email}
`);
}

try {
  await main();
} finally {
  await client.end();
  await appClient.end();
  process.exit(0);
}
