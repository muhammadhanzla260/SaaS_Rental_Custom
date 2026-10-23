import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { parsePreferences, SETTINGS_ROLES, type Role } from '@rental/core';
import { resolveTenantMembership, type Actor } from '@rental/db';
import { auth } from './auth';
import { db } from './db';

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser(next?: string) {
  const session = await getSession();
  if (!session) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  return session.user;
}

/** The signed-in user's membership in the tenant with this slug. 404s for non-members. */
export const getTenantContext = cache(async (slug: string) => {
  const user = await requireUser(`/${slug}`);
  const resolved = await resolveTenantMembership(db, slug, user.id);
  if (!resolved) notFound();
  const role = resolved.membership.role as Role;
  return {
    user,
    tenant: resolved.tenant,
    membership: resolved.membership,
    role,
    prefs: parsePreferences(resolved.tenant.settings),
    canManageSettings: SETTINGS_ROLES.includes(role),
  };
});

export type TenantContext = Awaited<ReturnType<typeof getTenantContext>>;

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || h.get('x-real-ip');
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

/** For server actions that change settings: owner or admin only. */
export async function requireSettingsAccess(slug: string) {
  const ctx = await getTenantContext(slug);
  if (!ctx.canManageSettings) throw new ActionError('Only owners and admins can change settings.');
  const actor: Actor & { role: Role } = { type: 'user', userId: ctx.user.id, ip: await clientIp(), role: ctx.role };
  return { ...ctx, actor };
}

/** For server actions that need one of these roles (owner and admin always pass). */
export async function requireRole(slug: string, roles: readonly Role[]) {
  const ctx = await getTenantContext(slug);
  if (!['owner', 'admin', ...roles].includes(ctx.role)) throw new ActionError('Your role cannot do this. Ask an admin.');
  const actor: Actor & { role: Role } = { type: 'user', userId: ctx.user.id, ip: await clientIp(), role: ctx.role };
  return { ...ctx, actor };
}

export const CAN_SELL: readonly Role[] = ['manager', 'sales'];
export const CAN_EDIT_CATALOG: readonly Role[] = ['manager'];

export class ActionError extends Error {}
