import { listActivity } from '@rental/db';
import { Card } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';

export const metadata = { title: 'Activity log' };

const LABELS: Record<string, string> = {
  'tenant.created': 'Created the organization',
  'tenant.profile_updated': 'Updated the business profile',
  'tenant.branding_updated': 'Changed the branding',
  'tenant.regional_updated': 'Changed region settings',
  'tenant.formats_updated': 'Changed formats',
  'tenant.hours_updated': 'Changed opening hours',
  'tenant.booking_updated': 'Changed booking rules',
  'tenant.numbering_updated': 'Changed document numbering',
  'tenant.communication_updated': 'Changed email settings',
  'location.created': 'Added a location',
  'location.updated': 'Updated a location',
  'location.deleted': 'Removed a location',
  'team.invited': 'Invited someone',
  'team.invite_revoked': 'Revoked an invitation',
  'team.invite_accepted': 'Joined the team',
  'team.member_updated': 'Changed a team member',
};

const HIDDEN_KEYS = new Set(['updatedAt', 'createdAt', 'tenantId', 'id', 'locationId']);

function summarize(changes: unknown): string[] {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes as Record<string, unknown>)
    .filter(([k]) => !HIDDEN_KEYS.has(k))
    .slice(0, 6)
    .map(([k, v]) => {
      const name = k.replace(/([A-Z])/g, ' $1').toLowerCase();
      if (v && typeof v === 'object' && 'to' in (v as object)) {
        const { from, to } = v as { from: unknown; to: unknown };
        const fmt = (x: unknown) => (x == null || x === '' ? 'empty' : typeof x === 'object' ? 'updated' : String(x));
        return `${name}: ${fmt(from)} → ${fmt(to)}`;
      }
      return `${name}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
    });
}

export default async function ActivitySettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await getTenantContext(slug);
  const rows = await listActivity(db, tenant.id, 100);
  const fmt = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card title="Activity log" description="Every change to your organization's settings and team: who, what and when. Kept permanently.">
      <ol className="-my-3 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1 py-3 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
            <time className="text-sm text-muted tabular" dateTime={new Date(r.at).toISOString()}>{fmt.format(new Date(r.at))}</time>
            <div className="min-w-0">
              <p className="text-[15px]">
                <span className="font-medium">{r.actor_name ?? (r.actor_type === 'system' ? 'System' : 'Someone')}</span>{' '}
                {(LABELS[r.action] ?? r.action).replace(/^./, (c) => c.toLowerCase())}
              </p>
              <ul className="mt-0.5 text-sm text-muted">
                {summarize(r.changes).map((line) => <li key={line} className="break-words">{line}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
