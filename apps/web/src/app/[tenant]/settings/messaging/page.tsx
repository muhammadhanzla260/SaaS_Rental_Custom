import { resolveMessaging, type MessageType } from '@rental/core';
import { customTemplates, getIntegrations, listLocations, listMessages, type MessageFilters } from '@rental/db';
import { liveDelivery } from '@rental/messaging';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { MessagingSettings, type LogRow } from './messaging-settings';

export const metadata = { title: 'Email, SMS & automations' };

const TABS = ['server', 'auto', 'log'] as const;
const LOG_FILTERS = ['all', 'upcoming', 'sent', 'failed', 'skipped'] as const;

export default async function MessagingPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string; status?: string; q?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'settings.manage');
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as (typeof TABS)[number]) : 'server';
  const status = (LOG_FILTERS as readonly string[]).includes(sp.status ?? '') ? (sp.status as (typeof LOG_FILTERS)[number]) : 'all';
  const [integrations, locations, custom, log] = await Promise.all([
    getIntegrations(db, ctx.tenant.id),
    listLocations(db, ctx.tenant.id),
    customTemplates(db, ctx.tenant.id),
    listMessages(db, ctx.tenant.id, {
      status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : (status as MessageFilters['status']),
      search: sp.q?.slice(0, 80) || undefined,
      limit: 200,
    }),
  ]);
  const m = resolveMessaging(ctx.prefs.messaging);
  const mail = integrations.orgMail;
  const sms = integrations.sms;
  const rows: LogRow[] = log.rows.map((r) => ({
    id: r.id, status: r.status, channel: r.channel, type: r.type as MessageType, toAddress: r.toAddress, subject: r.subject, orderNumber: r.orderNumber,
    orderId: r.orderId, when: (r.sentAt ?? r.scheduledFor).toISOString(), key: r.idempotencyKey, lastError: r.lastError, attempts: r.attempts,
  }));
  return (
    <MessagingSettings
      slug={slug}
      tab={tab}
      orgName={ctx.tenant.name}
      timezone={ctx.tenant.timezone}
      readOnly={ctx.readOnly}
      outbox={!liveDelivery()}
      settings={m}
      server={{
        mail: {
          mode: (mail?.mode as 'smtp') ?? 'platform', provider: (mail?.provider as 'google') ?? 'other', host: mail?.host ?? '', port: mail?.port ?? 587,
          security: (mail?.security as 'starttls') ?? 'starttls', username: mail?.username ?? '', password: '', fromName: mail?.fromName ?? '', fromEmail: mail?.fromEmail ?? '',
          hasSecret: !!mail?.hasSecret, verifiedAt: mail?.verifiedAt?.toISOString() ?? null, lastError: mail?.lastError ?? null,
        },
        replyTo: m.replyTo || mail?.replyTo || '',
        cc: m.cc.join(', '),
        bcc: m.bcc.join(', '),
        alertsTo: m.alertsTo.join(', ') || (ctx.tenant.email ?? ''),
        sms: { provider: (sms?.provider as 'none') ?? 'none', sendingNumber: sms?.sendingNumber ?? '', accountId: sms?.accountId ?? '', apiKey: '', hasSecret: !!sms?.hasSecret },
      }}
      locations={locations.map((l) => {
        const own = integrations.mail.find((x) => x.locationId === l.id);
        return { id: l.id, name: l.name, code: l.code, own: own ? { fromEmail: own.fromEmail, verified: !!own.verifiedAt } : null };
      })}
      customTemplates={custom.map((c) => `${c.type}:${c.channel}`)}
      log={{ rows, counts: log.counts, status, q: sp.q ?? '' }}
    />
  );
}
