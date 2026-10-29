import { and, eq, inArray } from 'drizzle-orm';
import { renderPrefix, sequenceScope, type DocumentKind, type DocumentNumbering } from '@rental/core';
import { withTenant, type Db } from '../client';
import { numberSequences } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';

const KINDS: DocumentKind[] = ['quote', 'invoice', 'receipt'];

/** Next number per document kind for one location code ("Q-AUS-" → 1043). */
export function getNextNumbers(db: Db, tenantId: string, numbering: DocumentNumbering, locCode: string) {
  return withTenant(db, tenantId, async (tx) => {
    const prefixes = KINDS.map((k) => ({ kind: k, prefix: renderPrefix(numbering[`${k}Prefix`], { loc: locCode }) }));
    const scopes = prefixes.map((p) => sequenceScope(p.kind, p.prefix));
    const rows = await tx.select().from(numberSequences).where(inArray(numberSequences.scope, scopes));
    return Object.fromEntries(
      prefixes.map((p) => [p.kind, { prefix: p.prefix, next: rows.find((r) => r.scope === sequenceScope(p.kind, p.prefix))?.nextValue ?? 1 }]),
    ) as Record<DocumentKind, { prefix: string; next: number }>;
  });
}

/** Set the next number for one rendered prefix (e.g. continue from an old system at 1042). It can only move forward. */
export function setNextNumber(db: Db, tenantId: string, actor: Actor, kind: DocumentKind, prefix: string, padding: number, next: number) {
  return withTenant(db, tenantId, async (tx) => {
    if (!Number.isInteger(next) || next < 1 || next > 99_999_999) throw new OrgError('Use a whole number from 1.', 'invalid');
    const scope = sequenceScope(kind, prefix);
    const [row] = await tx.select().from(numberSequences).where(and(eq(numberSequences.scope, scope))).limit(1);
    if (row && next < row.nextValue) throw new OrgError(`${prefix} is already at ${row.nextValue}. Numbers can only move forward, so no document number is ever reused.`, 'invalid');
    if (row) await tx.update(numberSequences).set({ nextValue: next, padding }).where(eq(numberSequences.scope, scope));
    else await tx.insert(numberSequences).values({ tenantId, scope, prefix, padding, nextValue: next });
    await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, 'tenant.numbering_updated', { [prefix]: { from: row?.nextValue ?? 1, to: next } });
  });
}
