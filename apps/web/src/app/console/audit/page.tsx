import Link from 'next/link';
import { listPlatformAudit, listPlatformOrgs } from '@rental/db';
import { Card, FilterChips, PageTitle, Pill } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { describeAudit } from '@/lib/audit-text';
import { requirePlatformAdmin } from '@/server/context';
import { db } from '@/server/db';

export const metadata = { title: 'Audit log' };

export default async function ConsoleAuditPage({ searchParams }: { searchParams: Promise<{ who?: string; org?: string }> }) {
  const { user } = await requirePlatformAdmin();
  const { who = 'all', org } = await searchParams;
  const orgs = await listPlatformOrgs(db, user.id);
  const tenantId = org && orgs.some((o) => o.id === org) ? org : null;
  const rows = await listPlatformAudit(db, user.id, { limit: 300, tenantId, platformOnly: who === 'platform' });
  const qs = (p: Record<string, string | null>) => {
    const s = new URLSearchParams();
    const next = { who, org: tenantId, ...p };
    if (next.who && next.who !== 'all') s.set('who', next.who);
    if (next.org) s.set('org', next.org);
    const str = s.toString();
    return `/console/audit${str ? `?${str}` : ''}`;
  };
  return (
    <>
      <Topbar crumbs={[{ label: 'Platform', href: '/console' }, { label: 'Audit log' }]} />
      <PageBody wide>
        <PageTitle title="Audit log" sub="Every change in every organization: who, what and when. Platform actions (yours) are marked." />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FilterChips
            label="Actor"
            value={who === 'platform' ? 'platform' : 'all'}
            chips={[
              { value: 'all', label: 'Everyone', href: qs({ who: 'all' }) },
              { value: 'platform', label: 'Platform only', href: qs({ who: 'platform' }) },
            ]}
          />
          {tenantId && (
            <Link href={qs({ org: null })} className="text-[13px] font-semibold text-accent-text hover:underline">
              Showing {orgs.find((o) => o.id === tenantId)?.name} · show all organizations
            </Link>
          )}
        </div>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-subtle">
            {rows.length === 0 && <li className="px-5 py-12 text-center text-sm text-fg-2">Nothing logged yet.</li>}
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <time className="mono w-40 shrink-0 text-xs text-fg-2" dateTime={r.at.toISOString()}>
                  {r.at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">
                    <span className="font-semibold">{r.actorType === 'platform' ? 'Platform' : (r.actorName ?? 'System')}</span>{' '}
                    {describeAudit(r.action, r.changes)}
                  </p>
                  {r.tenantName && (
                    <Link href={qs({ org: r.tenantId })} className="text-xs text-fg-2 hover:text-fg">
                      {r.tenantName} · {r.tenantSlug}
                    </Link>
                  )}
                </div>
                {r.actorType === 'platform' && <Pill tone="danger">Platform</Pill>}
              </li>
            ))}
          </ul>
        </Card>
      </PageBody>
    </>
  );
}
