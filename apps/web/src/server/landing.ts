import 'server-only';
import { isPlatformAdmin, listUserTenants } from '@rental/db';
import { db } from './db';

/**
 * Where a signed-in person lands (design 03 · Sign in "Routing"):
 * platform owner → console; one org → its home (or its setup, for an owner/admin
 * who has not finished onboarding); several → the org picker; none → register.
 */
export async function landingFor(userId: string, next?: string | null): Promise<string> {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  const [admin, orgs] = await Promise.all([isPlatformAdmin(db, userId), listUserTenants(db, userId)]);
  if (admin) return '/console';
  if (orgs.length === 1) {
    const o = orgs[0]!;
    return !o.onboarded && (o.role === 'owner' || o.role === 'admin') ? `/onboarding/${o.slug}` : `/${o.slug}`;
  }
  if (orgs.length > 1) return '/orgs';
  return '/register';
}
