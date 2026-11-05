'use client';

import { useMemo } from 'react';
import { mailAccountSchema } from '@rental/core';
import { SaveBar, Toggle } from '@/components/kit';
import { scope } from '@/components/fields/scope';
import { MailFields } from '@/components/settings/connect-fields';
import { useForm } from '@/lib/form';
import { zodFieldErrors } from '@/lib/result';
import { saveLocationMailAction } from '@/server/actions/settings';

export type LocationMailAccount = {
  host: string; port: number; security: 'starttls' | 'ssl' | 'none'; username: string; fromName: string; fromEmail: string;
  provider: 'google' | 'microsoft' | 'zoho' | 'other'; hasSecret: boolean;
};

/** A location's own mail server, or the workspace's. Lives in Settings → Email & SMS with the workspace server. */
export function LocationMailForm({ slug, locationId, mail, orgName, readOnly, onSaved }: {
  slug: string; locationId: string; mail: LocationMailAccount | null; orgName: string; readOnly: boolean; onSaved: (message?: string) => void;
}) {
  const initial = useMemo(() => ({
    own: !!mail,
    mail: {
      mode: 'smtp' as const, provider: mail?.provider ?? 'google', host: mail?.host ?? 'smtp.gmail.com', port: mail?.port ?? 587, security: mail?.security ?? 'starttls',
      username: mail?.username ?? '', password: '', fromName: mail?.fromName ?? '', fromEmail: mail?.fromEmail ?? '', hasSecret: !!mail?.hasSecret,
    },
  }), [mail]);
  const form = useForm(initial);
  const v = form.values;
  const save = () => {
    const m = { ...v.mail, password: v.mail.password || undefined };
    if (v.own) {
      const p = mailAccountSchema.safeParse(m);
      if (!p.success) { form.setErrors(Object.fromEntries(Object.entries(zodFieldErrors(p.error)).map(([k, msg]) => [`mail.${k}`, msg]))); return; }
    }
    form.submit(() => saveLocationMailAction(slug, locationId, { own: v.own, mail: v.own ? m : undefined }), (r) => { form.reset({ ...v, mail: { ...v.mail, password: '' } }); onSaved(r.message); });
  };
  return (
    <div className="flex flex-col gap-6">
      <Toggle checked={v.own} onChange={(x) => form.set('own', x)} label="Use this location's own mail server" sub="Off: this location's emails go through the workspace mail server above." />
      {v.own && <fieldset disabled={readOnly}><MailFields s={scope(form, 'mail')} orgName={orgName} platformOption={false} /></fieldset>}
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
    </div>
  );
}
