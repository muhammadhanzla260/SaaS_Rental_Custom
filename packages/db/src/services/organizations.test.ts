/**
 * Integration tests against the real local database (pnpm db:start + db:migrate),
 * connected as the restricted runtime role, exactly like the web app.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { onboardingSchema, type OnboardingInput } from '@rental/core';
import '../../scripts/env';
import { createDb, withTenant } from '../client';
import { auditLog, locations, memberships, tenants, users } from '../schema';
import {
  createOrganization, isSlugAvailable, listUserTenants, OrgError, resolveTenantMembership,
  updateBranding, updatePreferences, saveLogo, getFile,
} from './organizations';
import { createLocation, deleteLocation, getLocation, listLocations, updateLocation } from './locations';
import { acceptInvitation, createInvitation, findInvitation, listTeam, updateMember } from './team';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);

const onboarding = (slug: string, name: string): OnboardingInput =>
  onboardingSchema.parse({
    slug,
    profile: { name, email: `hello@${slug}.test`, phone: '(512) 981-5557', address: { line1: '1 Main St', city: 'Austin', country: 'US' } },
    branding: { brandColor: '#d32f2f', themeMode: 'system', radius: 'soft' },
    location: { name: 'Austin', code: 'AUS', address: { line1: '9 Depot Rd', city: 'Austin', country: 'US', lat: 30.4, lng: -97.7 }, loadingNotes: 'Gate 4321' },
    booking: { depositPercent: 30, defaultTaxPercent: 8.25 },
    // Set up from a laptop in Karachi: must not leak into an Austin business.
    deviceTimezone: 'Asia/Karachi',
  });

async function makeUser(label: string) {
  const id = `test-${label}-${run}`;
  await owner.db.insert(users).values({ id, name: label, email: `${label}-${run}@example.test` });
  return { id, email: `${label}-${run}@example.test` };
}

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let tenantA: typeof tenants.$inferSelect;
let tenantB: typeof tenants.$inferSelect;

beforeAll(async () => {
  alice = await makeUser('alice');
  bob = await makeUser('bob');
  tenantA = await createOrganization(db, { userId: alice.id }, onboarding(`fun-a-${run}`, 'Fun A'));
  tenantB = await createOrganization(db, { userId: bob.id }, onboarding(`fun-b-${run}`, 'Fun B'));
});

afterAll(async () => {
  await owner.db.delete(tenants).where(sql`${tenants.slug} like ${'%' + run}`);
  await owner.db.delete(users).where(sql`${users.id} like ${'%' + run}`);
  await owner.db.execute(sql`delete from audit_log where tenant_id in (select id from tenants where slug like ${'%' + run})`);
  await app.client.end();
  await owner.client.end();
});

describe('onboarding', () => {
  it('creates tenant, owner, primary location, tax and numbering, with the region detected', async () => {
    expect(tenantA.brandColor).toBe('#D32F2F');
    expect(tenantA.phone).toBe('+15129815557');
    expect(tenantA).toMatchObject({ country: 'US', timezone: 'America/Chicago', currency: 'USD' });
    const rows = await withTenant(db, tenantA.id, async (tx) => ({
      members: await tx.select().from(memberships),
      locs: await tx.select().from(locations),
      audit: await tx.select().from(auditLog),
    }));
    expect(rows.members).toMatchObject([{ userId: alice.id, role: 'owner' }]);
    expect(rows.locs).toMatchObject([{ name: 'Austin', code: 'AUS', isPrimary: true, lat: 30.4, timezone: 'America/Chicago', loadingNotes: 'Gate 4321' }]);
    expect(rows.audit.map((a) => a.action)).toContain('tenant.created');
    const loc = await getLocation(db, tenantA.id, rows.locs[0]!.id);
    expect(Number(loc!.taxRate!.rate)).toBe(8.25);
  });

  it('refuses a taken web address', async () => {
    expect(await isSlugAvailable(db, tenantA.slug)).toBe(false);
    await expect(createOrganization(db, { userId: alice.id }, onboarding(tenantA.slug, 'Copy'))).rejects.toBeInstanceOf(OrgError);
  });

  it('lists the organisations a user belongs to', async () => {
    const mine = await listUserTenants(db, alice.id);
    expect(mine.map((t) => t.slug)).toEqual([tenantA.slug]);
  });
});

describe('tenant isolation (row-level security)', () => {
  it('sees nothing without a tenant context', async () => {
    const rows = await db.select().from(locations);
    expect(rows).toHaveLength(0);
  });

  it("never shows one tenant's rows to another", async () => {
    const seen = await withTenant(db, tenantB.id, (tx) => tx.select().from(locations));
    expect(seen.every((l) => l.tenantId === tenantB.id)).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('refuses writes into another tenant', async () => {
    const error = await withTenant(db, tenantB.id, (tx) =>
      tx.insert(locations).values({ tenantId: tenantA.id, name: 'Sneaky', code: 'SNK', timezone: 'UTC' }),
    ).catch((e: Error) => e);
    expect(String((error as Error & { cause?: Error }).cause?.message)).toMatch(/row-level security/);
  });

  it('only lets a tenant update itself', async () => {
    const updated = await withTenant(db, tenantB.id, (tx) =>
      tx.update(tenants).set({ name: 'Hacked' }).where(eq(tenants.id, tenantA.id)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it('does not let a non-member resolve the tenant', async () => {
    expect(await resolveTenantMembership(db, tenantA.slug, bob.id)).toBeNull();
    expect((await resolveTenantMembership(db, tenantA.slug, alice.id))?.membership.role).toBe('owner');
  });
});

describe('settings', () => {
  const actor = () => ({ type: 'user' as const, userId: alice.id });

  it('updates branding and writes an audit entry with the change', async () => {
    const after = await updateBranding(db, tenantA.id, actor(), { brandColor: '#0E7C86', themeMode: 'dark', radius: 'round' });
    expect(after).toMatchObject({ brandColor: '#0E7C86', themeMode: 'dark', radius: 'round' });
    const log = await withTenant(db, tenantA.id, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'tenant.branding_updated')),
    );
    expect(log[0]?.changes).toMatchObject({ brandColor: { from: '#D32F2F', to: '#0E7C86' } });
  });

  it('stores booking defaults in settings', async () => {
    const prefs = await updatePreferences(db, tenantA.id, actor(), 'booking', {
      ...(await import('@rental/core')).bookingDefaultsSchema.parse({ depositPercent: 40, cleanupBufferMinutes: 120 }),
    });
    expect(prefs.booking.depositPercent).toBe(40);
    expect(prefs.hours).toHaveLength(7);
  });

  it('stores a logo and serves it back only inside its tenant', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const fileId = await saveLogo(db, tenantA.id, alice.id, { bytes, mime: 'image/svg+xml', filename: 'logo.svg' });
    expect((await getFile(db, tenantA.id, fileId))?.content?.toString()).toBe(bytes.toString());
    expect(await getFile(db, tenantB.id, fileId)).toBeNull();
    await expect(saveLogo(db, tenantA.id, alice.id, { bytes, mime: 'application/pdf', filename: 'x.pdf' })).rejects.toThrow(/PNG/);
  });
});

describe('locations', () => {
  const actor = () => ({ type: 'user' as const, userId: alice.id });
  const loc = (name: string, code: string, extra: Record<string, unknown> = {}) => ({
    name, code, isActive: true, isPrimary: false,
    address: { line1: '1 Dock St', city: 'Los Angeles', country: 'US', lat: 34.0522, lng: -118.2437 }, ...extra,
  }) as never;

  it('detects the time zone from the pin and keeps exactly one primary location', async () => {
    const la = await createLocation(db, tenantA.id, actor(), loc('Los Angeles', 'LAX'), 9.5);
    expect(la).toMatchObject({ timezone: 'America/Los_Angeles', isPrimary: false });
    await updateLocation(db, tenantA.id, actor(), la.id, loc('Los Angeles', 'LAX', { isPrimary: true }), 9.5);
    const all = await listLocations(db, tenantA.id);
    expect(all.filter((l) => l.isPrimary).map((l) => l.code)).toEqual(['LAX']);
    expect(Number(all.find((l) => l.code === 'LAX')!.taxRate!.rate)).toBe(9.5);
    await expect(deleteLocation(db, tenantA.id, actor(), la.id)).rejects.toThrow(/primary/);
    const aus = all.find((l) => l.code === 'AUS')!;
    await deleteLocation(db, tenantA.id, actor(), aus.id);
    expect((await listLocations(db, tenantA.id)).map((l) => l.code)).toEqual(['LAX']);
    expect(await getLocation(db, tenantA.id, aus.id)).toBeNull();
  });

  it('refuses a duplicate location code', async () => {
    await expect(createLocation(db, tenantA.id, actor(), loc('Dup', 'LAX'), 0)).rejects.toThrow(/already uses the code LAX/);
  });
});

describe('team', () => {
  it('invites by link, checks the email, and protects the last owner', async () => {
    const { token } = await createInvitation(db, tenantA.id, { type: 'user', userId: alice.id }, bob.email, 'sales');
    const preview = await findInvitation(db, token);
    expect(preview).toMatchObject({ tenantId: tenantA.id, role: 'sales', tenantName: 'Fun A' });
    await expect(acceptInvitation(db, token, { id: alice.id, email: alice.email })).rejects.toThrow(/This invitation is for/);
    await acceptInvitation(db, token, { id: bob.id, email: bob.email });
    await expect(acceptInvitation(db, token, { id: bob.id, email: bob.email })).rejects.toThrow(/already been used/);
    expect((await listUserTenants(db, bob.id)).map((t) => t.slug).sort()).toEqual([tenantA.slug, tenantB.slug].sort());

    const team = await listTeam(db, tenantA.id);
    const aliceM = team.members.find((m) => m.userId === alice.id)!;
    const bobM = team.members.find((m) => m.userId === bob.id)!;
    await expect(
      updateMember(db, tenantA.id, { type: 'user', userId: alice.id, role: 'owner' }, aliceM.id, { role: 'admin' }),
    ).rejects.toThrow(/at least one owner/);
    await expect(
      updateMember(db, tenantA.id, { type: 'user', userId: bob.id, role: 'admin' }, bobM.id, { role: 'owner' }),
    ).rejects.toThrow(/Only an owner/);
    const changed = await updateMember(db, tenantA.id, { type: 'user', userId: alice.id, role: 'owner' }, bobM.id, { role: 'manager' });
    expect(changed.role).toBe('manager');
  });
});
