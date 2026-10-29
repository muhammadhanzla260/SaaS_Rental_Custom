import { listActivity } from '@rental/db';
import { Card, PageTitle, Pill } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { describeAudit, summarizeChanges } from '@/lib/audit-text';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';

export const metadata = { title: 'Activity log' };

export default async function ActivityPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await pageContext(slug, 'settings.manage');
  const rows = await listActivity(db, tenant.id, 150);
  const fmt = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <>
      <Topbar crumbs={[{ label: 'Settings', href: `/${slug}/settings` }, { label: 'Activity log' }]} />
      <PageBody>
        <PageTitle title="Activity log" sub="Every change to your organization's settings and team: who, what and when. Support sessions by the platform appear here too." />
        <Card className="anim-rise overflow-hidden">
          <ol className="divide-y divide-subtle">
            {rows.length === 0 && <li className="px-5 py-12 text-center text-sm text-fg-2">Nothing yet.</li>}
            {rows.map((r) => {
              const lines = summarizeChanges(r.changes);
              return (
                <li key={r.id} className="grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-start sm:gap-4">
                  <time className="mono text-xs text-fg-2 sm:pt-0.5" dateTime={new Date(r.at).toISOString()}>{fmt.format(new Date(r.at))}</time>
                  <div className="min-w-0">
                    <p className="text-sm text-fg">
                      <span className="font-semibold">{r.actor_type === 'platform' ? 'Platform support' : (r.actor_name ?? (r.actor_type === 'system' ? 'System' : 'Someone'))}</span>{' '}
                      {describeAudit(r.action, r.changes)}
                    </p>
                    {lines.length > 0 && (
                      <ul className="mt-1 text-[13px] text-fg-2">
                        {lines.map((l) => <li key={l} className="break-words">{l}</li>)}
                      </ul>
                    )}
                  </div>
                  {r.actor_type === 'platform' && <Pill tone="danger">Support</Pill>}
                </li>
              );
            })}
          </ol>
        </Card>
      </PageBody>
    </>
  );
}
