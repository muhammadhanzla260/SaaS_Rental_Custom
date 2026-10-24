import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { can, parsePreferences, SETTINGS_ROLES, type Permission, type Role } from '@rental/core';
import { activeImpersonation, isPlatformAdmin, resolveTenantMembership, type Actor } from '@rental/db';
import { auth } from './auth';
import { db } from './db';

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser(next?: string) {
  const session = await getSession();
  if (!session) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  return session.user;
}

export const getIsPlatformAdmin = cache(async () => {
  const session = await getSession();
  return session ? isPlatformAdmin(db, session.user.id) : false;
});

/**
 * Who is acting inside an organization. 404s for anyone who is neither a
 * member nor the platform owner in an open support session (the existence
 * of another org's data is never revealed).
 */
export const getTenantContext = cache(async (slug: string) => {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/${slug}`)}`);
  const user = session.user;
  const resolved = await resolveTenantMembership(db, slug, user.id);
  if (!resolved) notFound();
  const { tenant } = resolved;

  let membership = resolved.membership;
  let impersonation: { id: string; reason: string; startedAt: Date } | null = null;
  if (!membership) {
    impersonation = await activeImpersonation(db, user.id, session.session.token, tenant.id);
    if (!impersonation) notFound();
  }

  const role: Role = membership ? (membership.role as Role) : 'viewer';
  const extra = membership?.permissions ?? [];
  const suspended = tenant.status === 'suspended';
  const readOnly = suspended || !!impersonation;
  return {
    user,
    sessionToken: session.session.token,
    tenant,
    membership,
    role,
    prefs: parsePreferences(tenant.settings),
    /** Permission check that respects extra grants. Read-only modes still allow reading. */
    can: (p: Permission) => !readOnly && can(role, p, extra),
    canManageSettings: !readOnly && SETTINGS_ROLES.includes(role),
    readOnly,
    suspended,
    impersonation,
  };
});

export type TenantContext = Awaited<ReturnType<typeof getTenantContext>>;

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || h.get('x-real-ip');
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}

export class ActionError extends Error {}

/** The one mutation gate: suspended orgs and support sessions are read-only. */
export function assertWritable(ctx: TenantContext) {
  if (ctx.impersonation) throw new ActionError('Support sessions are read-only. Nothing was changed.');
  if (ctx.suspended) throw new ActionError('This workspace is suspended, so it is read-only. Contact support to reactivate it.');
}

async function actorFor(ctx: TenantContext): Promise<Actor & { role: Role }> {
  return { type: 'user', userId: ctx.user.id, ip: await clientIp(), role: ctx.role };
}

/** For server actions that need a permission (extra grants count). */
export async function requirePermission(slug: string, permission: Permission) {
  const ctx = await getTenantContext(slug);
  assertWritable(ctx);
  if (!can(ctx.role, permission, ctx.membership?.permissions ?? [])) throw new ActionError('Your role cannot do this. Ask an admin.');
  return { ...ctx, actor: await actorFor(ctx) };
}

/** For server actions that change settings: owner or admin. */
export function requireSettingsAccess(slug: string) {
  return requirePermission(slug, 'settings.manage');
}

/** For server actions that need one of these roles (owner and admin always pass). */
export async function requireRole(slug: string, roles: readonly Role[]) {
  const ctx = await getTenantContext(slug);
  assertWritable(ctx);
  if (!['owner', 'admin', ...roles].includes(ctx.role)) throw new ActionError('Your role cannot do this. Ask an admin.');
  return { ...ctx, actor: await actorFor(ctx) };
}

/** Platform console pages and actions. Everyone else gets a 404. */
export async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session) redirect('/sign-in?next=/console');
  if (!(await isPlatformAdmin(db, session.user.id))) notFound();
  return { user: session.user, sessionToken: session.session.token, ip: await clientIp() };
}

export const CAN_SELL: readonly Role[] = ['manager', 'sales'];
export const CAN_EDIT_CATALOG: readonly Role[] = ['manager'];
