import type { Role } from '@rental/core';
import { listTeam } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { TeamPanel } from '../forms';

export const metadata = { title: 'Team' };

export default async function TeamSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const team = await listTeam(db, ctx.tenant.id);
  return (
    <TeamPanel
      slug={slug}
      me={ctx.user.id}
      myRole={ctx.role}
      members={team.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role as Role, status: m.status, userId: m.userId }))}
      invites={team.invites.map((i) => ({ id: i.id, email: i.email, role: i.role as Role, expiresAt: i.expiresAt.toISOString() }))}
    />
  );
}
