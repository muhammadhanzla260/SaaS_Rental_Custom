/**
 * Integration tests against the real local database (pnpm db:start + db:migrate),
 * connected as the restricted runtime role, exactly like the web app.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import {
  brandStepSchema, bookingDefaultsSchema, connectStepSchema, profileStepSchema, warehouseStepSchema, parsePreferences,
} from '@rental/core';
import '../../scripts/env';
import { createDb, withTenant } from '../client';
import { auditLog, locations, mailAccounts, memberships, tenants, users } from '../schema';
import {
  createWorkspace, getFile, isSlugAvailable, launchWorkspace, listUserTenants, markOnboarding, OrgError,
  resolveTenantMembership, saveBrandStep, saveLogo, saveProfileStep, saveWarehouseStep, updatePreferences,
} from './organizations';
import { createLocation, deleteLocation, getLocation, listLocations, updateLocation } from './locations';
import { acceptInvitation, createInvitation, createInvitations, findInvitation, listTeam, updateMember } from './team';
import { getIntegrations, getMailCredentials, saveConnectStep } from './integrations';
import {
  activeImpersonation, endImpersonation, listPlatformOrgs, platformCloseOrg, platformCreateOrg, platformRestoreOrg,
  platformSetStatus, platformUpdateOrg, startImpersonation,
} from './platform';
import { nextDocumentNumber } from './orders';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);

async function makeUser(label: string, platformAdmin = false) {
  const id = `test-${label}-${run}`;
  await owner.db.insert(users).values({ id, name: label, email: `${label}-${run}@example.test`, isPlatformAdmin: platformAdmin });
  return { id, email: `${label}-${run}@example.test` };
}

const warehouse = (code = 'AUS') =>
  warehouseStepSchema.parse({
    location: { name: 'Austin', code, address: { line1: '9 Depot Rd', city: 'Austin', country: 'US', lat: 30.4, lng: -97.7 }, loadingNotes: 'Gate 4321' },
    travel: { freeTravelDistance: 12, travelRateStaffed: 2.5, travelRateDropoff: 3 },
  });

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let root: { id: string; email: string };
let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;

beforeAll(async () => {
  alice = await makeUser('alice');
  bob = await makeUser('bob');
  root = await makeUser('root', true);
  // Registered from a laptop in Karachi: the US business still runs on a US clock.
  tenantA = await createWorkspace(db, { userId: alice.id }, { name: 'Fun A', slug: `fun-a-${run}`, country: 'US', deviceTimezone: 'Asia/Karachi' });
  tenantB = await createWorkspace(db, { userId: bob.id }, { name: 'Fun B', slug: `fun-b-${run}`, country: 'US' });
  await saveWarehouseStep(db, tenantB.id, { type: 'user', userId: bob.id }, warehouse());
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id in (select id from tenants where slug like ${'%' + run})`);
  await owner.db.delete(tenants).where(sql`${tenants.slug} like ${'%' + run}`);
  await owner.db.execute(sql`delete from released_slugs where slug like ${'%' + run}`);
  await owner.db.delete(users).where(sql`${users.id} like ${'%' + run}`);
  await app.client.end();
  await owner.client.end();
});

describe('registration and onboarding', () => {
  const actor = () => ({ type: 'user' as const, userId: alice.id });

  it('registers a trial workspace on the Growth plan with the owner and a detected region', async () => {
    expect(tenantA).toMatchObject({ status: 'trial', plan: 'growth', country: 'US', currency: 'USD', timezone: 'America/Chicago', onboardedAt: null });
    const rows = await withTenant(db, tenantA.id, async (tx) => ({
      members: await tx.select().from(memberships),
      audit: await tx.select().from(auditLog),
    }));
    expect(rows.members).toMatchObject([{ userId: alice.id, role: 'owner' }]);
    expect(rows.audit.map((a) => a.action)).toContain('tenant.created');
  });

  it('refuses a taken workspace URL', async () => {
    expect(await isSlugAvailable(db, tenantA.slug)).toBe(false);
    await expect(createWorkspace(db, { userId: alice.id }, { name: 'Copy', slug: tenantA.slug, country: 'US' })).rejects.toBeInstanceOf(OrgError);
  });

  it('saves each step and remembers progress', async () => {
    await saveProfileStep(db, tenantA.id, actor(), profileStepSchema.parse({
      profile: { name: 'Fun A Rentals', legalName: 'Fun A LLC', phone: '(512) 981-5557', address: { country: 'US' } },
      timezone: 'America/Chicago', currency: 'USD', dateFormat: 'DD/MM/YYYY', weekStartsOn: 'monday',
    }));
    await saveBrandStep(db, tenantA.id, actor(), brandStepSchema.parse({
      branding: { brandColor: '#b0306a', themeMode: 'light', radius: 'round' },
      brand: { sidebar: 'dark', headingFont: 'friendly', logo: { main: { zoom: 120 }, icon: { shape: 'circle' }, onDark: {} } },
    }));
    await saveWarehouseStep(db, tenantA.id, actor(), { ...warehouse(), taxPercent: 8.25 });
    await saveConnectStep(db, tenantA.id, actor(), connectStepSchema.parse({
      mail: { mode: 'smtp', provider: 'google', host: 'smtp.gmail.com', port: 587, username: 'bookings@fun-a.test', password: 'app-pass-123', fromEmail: 'bookings@fun-a.test' },
      sms: { provider: 'none' },
      payments: { provider: 'stripe', publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' },
    }));
    await markOnboarding(db, tenantA.id, 'connect', 'done', 4);
    await createInvitations(db, tenantA.id, actor(), [{ email: `crew-${run}@example.test`, role: 'crew' }]);
    await markOnboarding(db, tenantA.id, 'team', 'done', 5);
    const launched = await launchWorkspace(db, tenantA.id, actor(), 'scale');

    expect(launched).toMatchObject({ name: 'Fun A Rentals', legalName: 'Fun A LLC', phone: '+15129815557', brandColor: '#B0306A', plan: 'scale' });
    expect(launched.onboardedAt).toBeInstanceOf(Date);
    const prefs = parsePreferences(launched.settings);
    expect(prefs.formats).toMatchObject({ dateFormat: 'DD/MM/YYYY', weekStartsOn: 'monday' });
    expect(prefs.brand).toMatchObject({ headingFont: 'friendly', logo: { main: { zoom: 120 }, icon: { shape: 'circle' } } });
    expect(prefs.booking.freeTravelDistance).toBe(12);
    expect(prefs.onboarding.done).toEqual(expect.arrayContaining(['profile', 'brand', 'warehouse', 'connect', 'team', 'launch']));
    const locs = await listLocations(db, tenantA.id);
    expect(locs).toMatchObject([{ name: 'Austin', code: 'AUS', isPrimary: true, timezone: 'America/Chicago', loadingNotes: 'Gate 4321' }]);
    expect(Number(locs[0]!.taxRate!.rate)).toBe(8.25);
  });

  it('saving the warehouse step again updates the same location', async () => {
    await saveWarehouseStep(db, tenantA.id, actor(), { ...warehouse(), taxPercent: 8.25 });
    expect(await listLocations(db, tenantA.id)).toHaveLength(1);
  });

  it('lists the organizations a user belongs to with status', async () => {
    const mine = await listUserTenants(db, alice.id);
    expect(mine).toMatchObject([{ slug: tenantA.slug, role: 'owner', status: 'trial', onboarded: true, locations: 1 }]);
  });
});

describe('secrets', () => {
  it('stores SMTP and gateway secrets encrypted and never returns them to screens', async () => {
    const raw = await withTenant(db, tenantA.id, (tx) => tx.select().from(mailAccounts));
    expect(raw[0]!.secretEnc).toMatch(/^v1\./);
    expect(raw[0]!.secretEnc).not.toContain('app-pass-123');
    const view = await getIntegrations(db, tenantA.id);
    expect(view.orgMail).toMatchObject({ host: 'smtp.gmail.com', hasSecret: true });
    expect(JSON.stringify(view)).not.toMatch(/app-pass-123|sk_test_xyz|secretEnc/);
    expect(view.orgPayments).toMatchObject({ provider: 'stripe', keyMode: 'test', hasSecret: true });
    expect((await getMailCredentials(db, tenantA.id, null))?.password).toBe('app-pass-123');
    expect(await getMailCredentials(db, tenantB.id, null)).toBeNull();
  });
});

describe('tenant isolation (row-level security)', () => {
  it('sees nothing without a tenant context', async () => {
    expect(await db.select().from(locations)).toHaveLength(0);
  });

  it("never shows one tenant's rows to another", async () => {
    const seen = await withTenant(db, tenantB.id, (tx) => tx.select().from(locations));
    expect(seen.every((l) => l.tenantId === tenantB.id)).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("returns nothing (not an error) for another tenant's id: the app answers 404", async () => {
    const [aLoc] = await listLocations(db, tenantA.id);
    expect(await getLocation(db, tenantB.id, aLoc!.id)).toBeNull();
  });

  it('refuses writes into another tenant', async () => {
    const error = await withTenant(db, tenantB.id, (tx) =>
      tx.insert(locations).values({ tenantId: tenantA.id, name: 'Sneaky', code: 'SNK', timezone: 'UTC' }),
    ).catch((e: Error) => e);
    expect(String((error as Error & { cause?: Error }).cause?.message)).toMatch(/row-level security/);
  });

  it('only lets a tenant update itself', async () => {
    const updated = await withTenant(db, tenantB.id, (tx) => tx.update(tenants).set({ name: 'Hacked' }).where(eq(tenants.id, tenantA.id)).returning());
    expect(updated).toHaveLength(0);
  });

  it('does not let a non-member resolve the tenant', async () => {
    expect((await resolveTenantMembership(db, tenantA.slug, bob.id))?.membership).toBeNull();
    expect((await resolveTenantMembership(db, tenantA.slug, alice.id))?.membership?.role).toBe('owner');
  });

  it('cannot make anyone a platform admin through the app connection', async () => {
    const err = await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, alice.id)).catch((e: Error) => e);
    expect(String((err as Error & { cause?: Error }).cause?.message)).toMatch(/permission denied/);
    const id = `test-sneaky-${run}`;
    await db.insert(users).values({ id, name: 'Sneaky', email: `sneaky-${run}@example.test`, isPlatformAdmin: true });
    const [row] = await owner.db.select({ admin: users.isPlatformAdmin }).from(users).where(eq(users.id, id));
    expect(row!.admin).toBe(false);
  });
});

describe('settings', () => {
  const actor = () => ({ type: 'user' as const, userId: alice.id });

  it('stores rental rules in settings', async () => {
    const prefs = await updatePreferences(db, tenantA.id, actor(), 'booking', bookingDefaultsSchema.parse({ depositPercent: 40, cleanupBufferMinutes: 120, quoteValidDays: null }));
    expect(prefs.booking).toMatchObject({ depositPercent: 40, quoteValidDays: null, eventLocationFeeCents: 2000 });
  });

  it('stores a logo and serves it back only inside its tenant', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const fileId = await saveLogo(db, tenantA.id, alice.id, { bytes, mime: 'image/svg+xml', filename: 'logo.svg' });
    expect((await getFile(db, tenantA.id, fileId))?.content?.toString()).toBe(bytes.toString());
    expect(await getFile(db, tenantB.id, fileId)).toBeNull();
    await expect(saveLogo(db, tenantA.id, alice.id, { bytes, mime: 'application/pdf', filename: 'x.pdf' })).rejects.toThrow(/PNG/);
  });

  it('numbers documents per location: Q-AUS-00001, then Q-AUS-00002', async () => {
    const prefs = parsePreferences({});
    const [aus] = await listLocations(db, tenantA.id);
    const n1 = await withTenant(db, tenantA.id, (tx) => nextDocumentNumber(tx, 'quote', prefs, aus!.id));
    const n2 = await withTenant(db, tenantA.id, (tx) => nextDocumentNumber(tx, 'quote', prefs, aus!.id));
    expect([n1, n2]).toEqual(['Q-AUS-00001', 'Q-AUS-00002']);
    const inv = await withTenant(db, tenantA.id, (tx) => nextDocumentNumber(tx, 'invoice', prefs, aus!.id));
    expect(inv).toBe(`INV-${new Date().getUTCFullYear()}-0001`);
  });
});

describe('locations', () => {
  const actor = () => ({ type: 'user' as const, userId: alice.id });
  const loc = (name: string, code: string, extra: Record<string, unknown> = {}) =>
    warehouseStepSchema.shape.location.parse({
      name, code, isActive: true, isPrimary: false,
      address: { line1: '1 Dock St', city: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 },
      settings: { servedZips: ['90001'], freeTravelMiles: 15, paused: false },
      ...extra,
    });

  it('detects the time zone from the pin, keeps per-location settings and exactly one primary', async () => {
    const la = await createLocation(db, tenantA.id, actor(), loc('Los Angeles', 'LAX'), 9.5);
    expect(la).toMatchObject({ timezone: 'America/Los_Angeles', isPrimary: false, settings: { servedZips: ['90001'], freeTravelMiles: 15 } });
    await updateLocation(db, tenantA.id, actor(), la.id, loc('Los Angeles', 'LAX', { isPrimary: true, settings: { paused: true } }), 9.5);
    const all = await listLocations(db, tenantA.id);
    expect(all.filter((l) => l.isPrimary).map((l) => l.code)).toEqual(['LAX']);
    expect(all.find((l) => l.code === 'LAX')!.settings).toMatchObject({ paused: true });
    await expect(deleteLocation(db, tenantA.id, actor(), la.id)).rejects.toThrow(/primary/);
  });

  it('refuses a duplicate location code', async () => {
    await expect(createLocation(db, tenantA.id, actor(), loc('Dup', 'LAX'), 0)).rejects.toThrow(/already uses the code LAX/);
  });
});

describe('team', () => {
  it('invites with branches and commission, checks the email, and protects the last owner', async () => {
    const [aus] = (await listLocations(db, tenantA.id)).filter((l) => l.code === 'AUS');
    const { token } = await createInvitation(db, tenantA.id, { type: 'user', userId: alice.id }, {
      email: bob.email, role: 'sales', name: 'Bob', locationIds: [aus!.id], commissionPct: 5,
    });
    const preview = await findInvitation(db, token);
    expect(preview).toMatchObject({ tenantId: tenantA.id, role: 'sales', tenantName: 'Fun A Rentals', name: 'Bob' });
    await expect(acceptInvitation(db, token, { id: alice.id, email: alice.email })).rejects.toThrow(/This invitation is for/);
    await acceptInvitation(db, token, { id: bob.id, email: bob.email });
    await expect(acceptInvitation(db, token, { id: bob.id, email: bob.email })).rejects.toThrow(/already been used/);

    const team = await listTeam(db, tenantA.id);
    const aliceM = team.members.find((m) => m.userId === alice.id)!;
    const bobM = team.members.find((m) => m.userId === bob.id)!;
    expect(bobM).toMatchObject({ role: 'sales', commissionPct: 5, locationIds: [aus!.id] });
    await expect(updateMember(db, tenantA.id, { type: 'user', userId: alice.id, role: 'owner' }, aliceM.id, { role: 'admin' })).rejects.toThrow(/at least one owner/);
    await expect(updateMember(db, tenantA.id, { type: 'user', userId: bob.id, role: 'admin' }, bobM.id, { role: 'owner' })).rejects.toThrow(/Only an owner/);
    const changed = await updateMember(db, tenantA.id, { type: 'user', userId: alice.id, role: 'owner' }, bobM.id, { role: 'coach', vehicle: 'Van 2' });
    expect(changed).toMatchObject({ role: 'coach', vehicle: 'Van 2', commissionRate: null });
  });
});

describe('platform console', () => {
  const sessionToken = `session-${run}`;

  it('is closed to everyone but the platform owner', async () => {
    await expect(listPlatformOrgs(db, alice.id)).rejects.toThrow();
    const orgs = await listPlatformOrgs(db, root.id);
    expect(orgs.find((o) => o.id === tenantA.id)).toMatchObject({ ownerEmail: alice.email, onboardingPercent: 100, users: 2 });
    expect(orgs.find((o) => o.id === tenantB.id)).toMatchObject({ onboardingPercent: 17, locations: 1 });
  });

  it('creates an org with an owner invitation, edits it and blocks the old URL', async () => {
    const ownerEmail = `owner-${run}@example.test`;
    const { tenant, ownerToken } = await platformCreateOrg(db, root.id, {
      name: 'Lakeside Party Rentals', slug: `lakeside-${run}`, country: 'US', timezone: 'America/Chicago', currency: 'USD',
      plan: 'growth', status: 'trial', ownerName: 'Jordan Reyes', ownerEmail,
    });
    expect(await findInvitation(db, ownerToken)).toMatchObject({ role: 'owner', email: ownerEmail, name: 'Jordan Reyes' });
    const row = (await listPlatformOrgs(db, root.id)).find((o) => o.id === tenant.id);
    expect(row).toMatchObject({ ownerEmail, ownerPending: true, plan: 'growth', status: 'trial' });

    const renamed = await platformUpdateOrg(db, root.id, tenant.id, {
      name: 'Lakeside', slug: `lakeside2-${run}`, timezone: 'America/Chicago', currency: 'USD', plan: 'scale', status: 'active',
    });
    expect(renamed).toMatchObject({ slug: `lakeside2-${run}`, plan: 'scale', status: 'active' });
    expect(await isSlugAvailable(db, `lakeside-${run}`)).toBe(false);
  });

  it('suspends, closes with the typed slug, and restores', async () => {
    const s = await platformSetStatus(db, root.id, tenantB.id, 'suspended');
    expect(s.status).toBe('suspended');
    expect((await listUserTenants(db, bob.id)).find((t) => t.tenant_id === tenantB.id)?.status).toBe('suspended');
    await expect(platformCloseOrg(db, root.id, tenantB.id, 'wrong')).rejects.toThrow(/exactly/);
    const closed = await platformCloseOrg(db, root.id, tenantB.id, tenantB.slug);
    expect(closed.status).toBe('closed');
    expect(closed.purgeAfter!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await listUserTenants(db, bob.id)).map((t) => t.tenant_id)).not.toContain(tenantB.id);
    expect(await resolveTenantMembership(db, tenantB.slug, bob.id)).toBeNull();
    const restored = await platformRestoreOrg(db, root.id, tenantB.id);
    expect(restored).toMatchObject({ status: 'trial', purgeAfter: null });
  });

  it('opens a read-only support session bound to the login session, and audits it', async () => {
    await expect(startImpersonation(db, alice.id, tenantB.id, sessionToken, 'help')).rejects.toThrow();
    await startImpersonation(db, root.id, tenantB.id, sessionToken, 'Owner asked for help with tax');
    expect(await activeImpersonation(db, root.id, sessionToken, tenantB.id)).toMatchObject({ reason: 'Owner asked for help with tax' });
    expect(await activeImpersonation(db, root.id, 'another-session', tenantB.id)).toBeNull();
    expect(await activeImpersonation(db, root.id, sessionToken, tenantA.id)).toBeNull();
    await endImpersonation(db, root.id, sessionToken);
    expect(await activeImpersonation(db, root.id, sessionToken, tenantB.id)).toBeNull();
    const log = await withTenant(db, tenantB.id, (tx) => tx.select().from(auditLog).where(sql`${auditLog.action} like 'platform.%'`));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining([
      'platform.org_suspended', 'platform.org_closed', 'platform.org_restored', 'platform.impersonation_started', 'platform.impersonation_ended',
    ]));
  });
});
