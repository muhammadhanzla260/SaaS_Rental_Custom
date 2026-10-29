import { listLocations, listTeam } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { TeamSettings } from './team-settings';

export const metadata = { title: 'Team & roles' };

export default async function TeamPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await pageContext(slug, 'members.manage');
  const [team, locs] = await Promise.all([listTeam(db, ctx.tenant.id), listLocations(db, ctx.tenant.id)]);
  return (
    <TeamSettings
      slug={slug}
      me={{ userId: ctx.user.id, role: ctx.role }}
      readOnly={ctx.readOnly}
      locations={locs.map((l) => ({ id: l.id, code: l.code, name: l.name }))}
      members={team.members.map((m) => ({
        kind: 'member' as const, id: m.id, userId: m.userId, name: m.name, email: m.email, image: m.image, role: m.role,
        status: m.status as 'active' | 'disabled', locationIds: m.locationIds, commissionPct: m.commissionPct, vehicle: m.vehicle, permissions: m.permissions,
      }))}
      invites={team.invites.map((i) => ({
        kind: 'invite' as const, id: i.id, name: i.name, email: i.email, role: i.role, locationIds: i.locationIds, commissionPct: i.commissionPct,
        vehicle: i.vehicle, permissions: i.permissions, expiresAt: i.expiresAt.toISOString(),
      }))}
    />
  );
}
