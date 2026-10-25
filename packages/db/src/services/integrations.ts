import { and, eq, isNull } from 'drizzle-orm';
import type { MailAccountInput, PaymentAccountInput, SmsAccountInput } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { decryptSecret, encryptSecret } from '../crypto';
import { mailAccounts, paymentAccounts, smsAccounts } from '../schema';
import { audit, type Actor } from './audit';

export type MailAccount = typeof mailAccounts.$inferSelect;

/** What screens may see: everything except the secret itself. */
export type MailAccountView = Omit<MailAccount, 'secretEnc'> & { hasSecret: boolean };
export type SmsAccountView = Omit<typeof smsAccounts.$inferSelect, 'secretEnc'> & { hasSecret: boolean };
export type PaymentAccountView = Omit<typeof paymentAccounts.$inferSelect, 'secretEnc'> & { hasSecret: boolean };

function strip<T extends { secretEnc: string | null }>(row: T): Omit<T, 'secretEnc'> & { hasSecret: boolean } {
  const { secretEnc, ...rest } = row;
  return { ...rest, hasSecret: !!secretEnc };
}

const scopeWhere = (table: typeof mailAccounts | typeof paymentAccounts, locationId: string | null) =>
  locationId ? eq(table.locationId, locationId) : isNull(table.locationId);

export function getIntegrations(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const mail = await tx.select().from(mailAccounts);
    const [sms] = await tx.select().from(smsAccounts).limit(1);
    const pay = await tx.select().from(paymentAccounts);
    return {
      mail: mail.map(strip),
      orgMail: mail.find((m) => !m.locationId) ? strip(mail.find((m) => !m.locationId)!) : null,
      sms: sms ? strip(sms) : null,
      payments: pay.map(strip),
      orgPayments: pay.find((p) => !p.locationId) ? strip(pay.find((p) => !p.locationId)!) : null,
    };
  });
}

async function upsertMailTx(tx: Tx, tenantId: string, actor: Actor, locationId: string | null, input: MailAccountInput) {
  const [existing] = await tx.select().from(mailAccounts).where(scopeWhere(mailAccounts, locationId)).limit(1);
  const smtp = input.mode === 'smtp';
  const values = {
    mode: input.mode,
    provider: input.provider,
    host: smtp ? input.host ?? null : null,
    port: input.port,
    security: input.security,
    username: smtp ? input.username ?? null : null,
    // An empty password keeps the saved one; switching to the platform sender forgets it.
    secretEnc: !smtp ? null : input.password ? encryptSecret(input.password) : existing?.secretEnc ?? null,
    fromName: input.fromName ?? null,
    fromEmail: smtp ? input.fromEmail ?? null : null,
    replyTo: input.replyTo ?? null,
    // Any change needs a new test before the account counts as verified.
    verifiedAt: null,
    lastError: null,
  };
  const [row] = existing
    ? await tx.update(mailAccounts).set(values).where(eq(mailAccounts.id, existing.id)).returning()
    : await tx.insert(mailAccounts).values({ tenantId, locationId, ...values }).returning();
  await audit(tx, tenantId, actor, { type: 'mail_account', id: row!.id }, 'integrations.mail_saved', {
    mode: input.mode, host: values.host, username: values.username, location: locationId ?? 'org', passwordChanged: !!input.password,
  });
  return strip(row!);
}

export function saveMailAccount(db: Db, tenantId: string, actor: Actor, locationId: string | null, input: MailAccountInput) {
  return withTenant(db, tenantId, (tx) => upsertMailTx(tx, tenantId, actor, locationId, input));
}

export function removeLocationMailAccount(db: Db, tenantId: string, actor: Actor, locationId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.delete(mailAccounts).where(eq(mailAccounts.locationId, locationId)).returning({ id: mailAccounts.id });
    if (rows[0]) await audit(tx, tenantId, actor, { type: 'mail_account', id: rows[0].id }, 'integrations.mail_removed', { location: locationId });
  });
}

/** Full credentials for sending (server only). */
export function getMailCredentials(db: Db, tenantId: string, locationId: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const [own] = locationId ? await tx.select().from(mailAccounts).where(eq(mailAccounts.locationId, locationId)).limit(1) : [];
    const [org] = await tx.select().from(mailAccounts).where(isNull(mailAccounts.locationId)).limit(1);
    const acc = own ?? org;
    if (!acc) return null;
    return { ...acc, password: acc.secretEnc ? decryptSecret(acc.secretEnc) : null };
  });
}

export function recordMailCheck(db: Db, tenantId: string, accountId: string, ok: boolean, error: string | null) {
  return withTenant(db, tenantId, (tx) =>
    tx.update(mailAccounts).set({ verifiedAt: ok ? new Date() : null, lastError: ok ? null : error?.slice(0, 500) ?? 'Failed' }).where(eq(mailAccounts.id, accountId)),
  );
}

async function upsertSmsTx(tx: Tx, tenantId: string, actor: Actor, input: SmsAccountInput) {
  const [existing] = await tx.select().from(smsAccounts).limit(1);
  const none = input.provider === 'none';
  const values = {
    provider: input.provider,
    sendingNumber: none ? null : input.sendingNumber ?? null,
    accountId: none ? null : input.accountId ?? null,
    secretEnc: none ? null : input.apiKey ? encryptSecret(input.apiKey) : existing?.secretEnc ?? null,
  };
  const [row] = existing
    ? await tx.update(smsAccounts).set(values).where(eq(smsAccounts.id, existing.id)).returning()
    : await tx.insert(smsAccounts).values({ tenantId, ...values }).returning();
  await audit(tx, tenantId, actor, { type: 'sms_account', id: row!.id }, 'integrations.sms_saved', {
    provider: input.provider, sendingNumber: values.sendingNumber, keyChanged: !!input.apiKey,
  });
  return strip(row!);
}

export function saveSmsAccount(db: Db, tenantId: string, actor: Actor, input: SmsAccountInput) {
  return withTenant(db, tenantId, (tx) => upsertSmsTx(tx, tenantId, actor, input));
}

async function upsertPaymentTx(tx: Tx, tenantId: string, actor: Actor, locationId: string | null, input: PaymentAccountInput) {
  const [existing] = await tx.select().from(paymentAccounts).where(scopeWhere(paymentAccounts, locationId)).limit(1);
  const none = input.provider === 'manual';
  const key = input.secretKey || null;
  const values = {
    provider: input.provider,
    merchantId: input.provider === 'ipos' ? input.merchantId ?? existing?.merchantId ?? null : null,
    publishableKey: input.provider === 'stripe' ? input.publishableKey || existing?.publishableKey || null : null,
    secretEnc: none ? null : key ? encryptSecret(key) : existing?.provider === input.provider ? existing?.secretEnc ?? null : null,
    keyMode: input.provider !== 'stripe'
      ? null
      : key ? (key.includes('_live_') ? 'live' : 'test') : existing?.keyMode ?? ((input.publishableKey ?? '').includes('_live_') ? 'live' : 'test'),
  };
  const [row] = existing
    ? await tx.update(paymentAccounts).set(values).where(eq(paymentAccounts.id, existing.id)).returning()
    : await tx.insert(paymentAccounts).values({ tenantId, locationId, ...values }).returning();
  await audit(tx, tenantId, actor, { type: 'payment_account', id: row!.id }, 'integrations.payments_saved', {
    provider: input.provider, mode: values.keyMode, location: locationId ?? 'org', keyChanged: !!key,
  });
  return strip(row!);
}

export function savePaymentAccount(db: Db, tenantId: string, actor: Actor, locationId: string | null, input: PaymentAccountInput) {
  return withTenant(db, tenantId, (tx) => upsertPaymentTx(tx, tenantId, actor, locationId, input));
}

export function removeLocationPaymentAccount(db: Db, tenantId: string, actor: Actor, locationId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.delete(paymentAccounts).where(and(eq(paymentAccounts.locationId, locationId))).returning({ id: paymentAccounts.id });
    if (rows[0]) await audit(tx, tenantId, actor, { type: 'payment_account', id: rows[0].id }, 'integrations.payments_removed', { location: locationId });
  });
}

/** Onboarding step 4: all three in one transaction. */
export function saveConnectStep(db: Db, tenantId: string, actor: Actor, input: { mail: MailAccountInput; sms: SmsAccountInput; payments: PaymentAccountInput }) {
  return withTenant(db, tenantId, async (tx) => {
    await upsertMailTx(tx, tenantId, actor, null, input.mail);
    await upsertSmsTx(tx, tenantId, actor, input.sms);
    await upsertPaymentTx(tx, tenantId, actor, null, input.payments);
  });
}

/**
 * Card gateway for a sale at a location: the location's own account if it has
 * one, else the workspace's. The secret is decrypted for server use only.
 */
export function getPaymentCredentials(db: Db, tenantId: string, locationId: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const own = locationId
      ? (await tx.select().from(paymentAccounts).where(and(eq(paymentAccounts.tenantId, tenantId), eq(paymentAccounts.locationId, locationId))).limit(1))[0]
      : undefined;
    const org = (await tx.select().from(paymentAccounts).where(and(eq(paymentAccounts.tenantId, tenantId), isNull(paymentAccounts.locationId))).limit(1))[0];
    const acc = own && own.provider !== 'manual' ? own : org;
    if (!acc || acc.provider === 'manual') return null;
    return {
      id: acc.id, provider: acc.provider as 'stripe' | 'ipos', publishableKey: acc.publishableKey, merchantId: acc.merchantId, keyMode: acc.keyMode,
      secret: acc.secretEnc ? decryptSecret(acc.secretEnc) : null,
    };
  });
}
