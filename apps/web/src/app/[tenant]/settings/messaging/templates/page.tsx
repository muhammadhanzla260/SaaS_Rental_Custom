import { notFound } from 'next/navigation';
import { checkAccent, MESSAGE_TYPES, type Channel, type MessageType } from '@rental/core';
import { customTemplates, getTemplate } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { appUrl } from '@/server/mailer';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { TemplateEditor } from './template-editor';

export const metadata = { title: 'Message templates' };

export default async function TemplatesPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ type?: string; channel?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'settings.manage');
  const type = (sp.type && sp.type in MESSAGE_TYPES ? sp.type : 'quote') as MessageType;
  const channels = MESSAGE_TYPES[type].channels as readonly Channel[];
  const channel = (channels.includes(sp.channel as Channel) ? sp.channel : channels[0]) as Channel;
  if (!channel) notFound();
  const [template, custom] = await Promise.all([getTemplate(db, ctx.tenant.id, type, channel), customTemplates(db, ctx.tenant.id)]);
  const color = ctx.tenant.brandColor || '#2C4FE0';
  const logo = fileUrl(ctx.tenant.id, ctx.tenant.logoFileId);
  return (
    <TemplateEditor
      key={`${type}:${channel}:${template.version}`}
      slug={slug}
      type={type}
      channel={channel}
      template={{ ...template, updatedAt: template.updatedAt?.toISOString() ?? null }}
      edited={custom.map((c) => `${c.type}:${c.channel}`)}
      brand={{
        orgName: ctx.tenant.name, brandColor: color, onBrand: checkAccent(color).onAccent, logoUrl: logo ? appUrl(logo) : null,
        phone: ctx.tenant.phone, address: [ctx.tenant.line1, ctx.tenant.city, ctx.tenant.region].filter(Boolean).join(', ') || null,
        footer: ctx.prefs.brand.invoiceFooter ?? null, header: ctx.prefs.brand.emailHeader === 'white' ? 'white' : 'band',
      }}
      fromLine={`${ctx.tenant.name}`}
      readOnly={ctx.readOnly}
    />
  );
}
