/** Plain-English wording for audit actions (org activity log and platform console). */
const LABELS: Record<string, string> = {
  'tenant.created': 'created the organization',
  'tenant.launched': 'finished setup and launched the workspace',
  'tenant.profile_updated': 'updated the business profile',
  'tenant.branding_updated': 'changed the brand and theme',
  'tenant.brand_updated': 'changed customer-facing brand details',
  'tenant.regional_updated': 'changed region settings',
  'tenant.formats_updated': 'changed date and number formats',
  'tenant.hours_updated': 'changed opening hours',
  'tenant.booking_updated': 'changed rental rules',
  'tenant.numbering_updated': 'changed document numbering',
  'tenant.communication_updated': 'changed email settings',
  'location.created': 'added a location',
  'location.updated': 'updated a location',
  'location.deleted': 'removed a location',
  'team.invited': 'invited someone',
  'team.invite_resent': 'resent an invitation',
  'team.invite_revoked': 'revoked an invitation',
  'team.invite_accepted': 'joined the team',
  'team.member_updated': 'changed a team member',
  'integrations.mail_saved': 'saved the mail server',
  'integrations.mail_removed': 'removed a location mail server',
  'integrations.sms_saved': 'saved text-message settings',
  'integrations.payments_saved': 'saved card payment settings',
  'integrations.payments_removed': 'removed a location payment account',
  'platform.org_updated': 'edited the organization',
  'platform.org_suspended': 'suspended the organization',
  'platform.org_reactivated': 'reactivated the organization',
  'platform.org_closed': 'deleted the organization (30-day grace)',
  'platform.org_restored': 'restored the organization',
  'platform.impersonation_started': 'opened a read-only support session',
  'platform.impersonation_ended': 'ended the support session',
};

const HIDDEN_KEYS = new Set(['updatedAt', 'createdAt', 'tenantId', 'id', 'locationId', 'settings']);

export function describeAudit(action: string, _changes?: unknown): string {
  return LABELS[action] ?? action.replace(/[._]/g, ' ');
}

/** Short "field: before → after" lines. */
export function summarizeChanges(changes: unknown, max = 6): string[] {
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes as Record<string, unknown>)
    .filter(([k]) => !HIDDEN_KEYS.has(k))
    .slice(0, max)
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

export function timeAgo(at: Date, now = new Date()): string {
  const s = Math.round((now.getTime() - at.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
