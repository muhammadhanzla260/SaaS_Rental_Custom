'use client';

import { MAIL_PRESETS, PAYMENT_PROVIDERS } from '@rental/core';
import { Field, Input, RadioCards, Segmented, Select } from '@/components/kit';
import { fid, type Scope } from '@/components/fields/scope';

export type ConnectDraft = {
  mail: { mode: 'platform' | 'smtp'; provider: 'google' | 'microsoft' | 'zoho' | 'other'; host: string; port: number; security: 'starttls' | 'ssl' | 'none'; username: string; password: string; fromName: string; fromEmail: string; hasSecret: boolean; verifiedAt?: string | null };
  sms: { provider: 'none' | 'twilio' | 'quo'; sendingNumber: string; accountId: string; apiKey: string; hasSecret: boolean };
  payments: { provider: 'manual' | 'stripe' | 'ipos'; publishableKey: string; secretKey: string; merchantId: string; hasSecret: boolean; keyMode?: string | null };
};

/** Payload for connectStepSchema: empty secrets mean "keep the saved one". */
export function connectPayload(c: ConnectDraft) {
  return {
    mail: { ...c.mail, password: c.mail.password || undefined },
    sms: { ...c.sms, apiKey: c.sms.apiKey || undefined },
    payments: { ...c.payments, secretKey: c.payments.secretKey || undefined },
  };
}

function T({ s, name, label, hint, type = 'text', placeholder, mono, optional }: { s: Scope; name: string; label: string; hint?: string; type?: string; placeholder?: string; mono?: boolean; optional?: boolean }) {
  return (
    <Field label={label} htmlFor={fid(s, name)} hint={hint} error={s.err(name)} optional={optional}>
      <Input id={fid(s, name)} type={type} mono={mono} value={s.v[name] ?? ''} placeholder={placeholder} invalid={!!s.err(name)} autoComplete="off" onChange={(e) => s.set(name, e.target.value)} />
    </Field>
  );
}

function Secret({ s, name, label, saved, hint, placeholder }: { s: Scope; name: string; label: string; saved: boolean; hint: string; placeholder?: string }) {
  return (
    <Field label={label} htmlFor={fid(s, name)} hint={saved ? 'Saved and encrypted. Leave empty to keep it.' : hint} error={s.err(name)}>
      <Input id={fid(s, name)} type="password" autoComplete="new-password" mono value={s.v[name] ?? ''} placeholder={saved ? '••••••••••' : placeholder} invalid={!!s.err(name)} onChange={(e) => s.set(name, e.target.value)} />
    </Field>
  );
}

export function MailFields({ s, orgName, platformOption = true }: { s: Scope; orgName: string; platformOption?: boolean }) {
  const m = s.v as ConnectDraft['mail'];
  const preset = (key: string) => {
    const p = MAIL_PRESETS.find((x) => x.key === key)!;
    s.set('provider', p.key);
    if (p.host) { s.set('host', p.host); s.set('port', p.port); s.set('security', p.security); }
  };
  return (
    <div className="flex flex-col gap-5">
      {platformOption && (
        <RadioCards
          label="Email sending"
          value={m.mode}
          onChange={(x) => s.set('mode', x)}
          options={[
            { value: 'smtp', label: 'My own mail server (SMTP)', sub: 'Emails come from your domain. Best for deliverability.' },
            { value: 'platform', label: 'Send from Tentpole for now', sub: 'From no-reply with your name. Switch any time.' },
          ]}
        />
      )}
      {m.mode === 'smtp' && (
        <div className="anim-rise flex flex-col gap-5">
          <Field label="Provider" htmlFor={fid(s, 'provider')}>
            {/* Four long names don't fit a phone: a dropdown there, buttons from tablet up. */}
            <Select id={fid(s, 'provider')} value={m.provider} onChange={(e) => preset(e.target.value)} className="sm:hidden">
              {MAIL_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
            <div className="max-sm:hidden"><Segmented label="Mail provider" value={m.provider} onChange={preset} options={MAIL_PRESETS.map((p) => ({ value: p.key, label: p.label }))} /></div>
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_110px_150px]">
            <T s={s} name="host" label="SMTP host" mono />
            <Field label="Port" htmlFor={fid(s, 'port')} error={s.err('port')}>
              <Input id={fid(s, 'port')} mono inputMode="numeric" value={String(m.port)} onChange={(e) => s.set('port', Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </Field>
            <Field label="Security" htmlFor={fid(s, 'security')}>
              <Select id={fid(s, 'security')} value={m.security} onChange={(e) => s.set('security', e.target.value)}>
                <option value="starttls">STARTTLS</option>
                <option value="ssl">SSL / TLS</option>
                <option value="none">None</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <T s={s} name="username" label="Username" />
            <Secret s={s} name="password" label="Password or app password" saved={m.hasSecret} hint="Encrypted. Never shown again." />
            <T s={s} name="fromName" label="From name" optional placeholder={orgName} />
            <T s={s} name="fromEmail" label="From email" type="email" placeholder="bookings@yourbusiness.com" />
          </div>
        </div>
      )}
    </div>
  );
}

export function SmsFields({ s }: { s: Scope }) {
  const m = s.v as ConnectDraft['sms'];
  return (
    <div className="flex flex-col gap-5">
      <Segmented label="Text message provider" value={m.provider} onChange={(x) => s.set('provider', x)} options={[{ value: 'quo', label: 'Quo' }, { value: 'twilio', label: 'Twilio' }, { value: 'none', label: 'Not now' }]} />
      {m.provider !== 'none' && (
        <div className="anim-rise grid grid-cols-1 gap-5 sm:grid-cols-2">
          <T s={s} name="sendingNumber" label="Sending number" type="tel" placeholder="+1 512 555 0100" />
          {m.provider === 'twilio' && <T s={s} name="accountId" label="Account SID" mono />}
          <Secret s={s} name="apiKey" label="API key" saved={m.hasSecret} hint="Encrypted. Never shown again." />
        </div>
      )}
    </div>
  );
}

export function PaymentFields({ s }: { s: Scope }) {
  const m = s.v as ConnectDraft['payments'];
  return (
    <div className="flex flex-col gap-5">
      <RadioCards label="Card payments" columns={3} value={m.provider} onChange={(x) => s.set('provider', x)} options={PAYMENT_PROVIDERS.map((p) => ({ value: p.key, label: p.label, sub: p.sub }))} />
      {m.provider === 'stripe' && (
        <div className="anim-rise grid grid-cols-1 gap-5 sm:grid-cols-2">
          <T s={s} name="publishableKey" label="Publishable key" mono placeholder="pk_test_…" />
          <Secret s={s} name="secretKey" label="Secret key" saved={m.hasSecret} hint="Use a test key (sk_test_) until you go live." placeholder="sk_test_…" />
          {m.keyMode && <p className="text-[13px] text-fg-2 sm:col-span-2">Saved key is in <strong className="text-fg">{m.keyMode}</strong> mode.</p>}
        </div>
      )}
      {m.provider === 'ipos' && (
        <div className="anim-rise grid grid-cols-1 gap-5 sm:grid-cols-2">
          <T s={s} name="merchantId" label="Terminal ID (TPN)" mono />
          <Secret s={s} name="secretKey" label="Auth token" saved={m.hasSecret} hint="Encrypted. Never shown again." />
        </div>
      )}
    </div>
  );
}
