import { listPlatformOrgs } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { requirePlatformAdmin } from '@/server/context';
import { db } from '@/server/db';
import { OrgsConsole } from './orgs-console';

export const metadata = { title: 'Organizations' };

export default async function ConsolePage() {
  const { user } = await requirePlatformAdmin();
  const orgs = await listPlatformOrgs(db, user.id);
  const domain = process.env.PLATFORM_APP_DOMAIN || 'tentpole.app';
  return (
    <OrgsConsole
      domain={domain}
      orgs={orgs.map((o) => ({
        ...o,
        logoUrl: fileUrl(o.id, o.logoFileId),
        createdAt: o.createdAt.toISOString(),
        onboardedAt: o.onboardedAt?.toISOString() ?? null,
        closedAt: o.closedAt?.toISOString() ?? null,
        purgeAfter: o.purgeAfter?.toISOString() ?? null,
      }))}
    />
  );
}
