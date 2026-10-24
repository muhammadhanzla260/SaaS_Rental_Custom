import type { Tx } from '../client';
import { auditLog } from '../schema';

export type Actor = { type: 'user' | 'system' | 'customer' | 'api' | 'ai' | 'platform'; userId?: string | null; ip?: string | null };

/** Shallow before/after diff, so the log stores only what changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export async function audit(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  entity: { type: string; id: string },
  action: string,
  changes?: unknown,
) {
  await tx.insert(auditLog).values({
    tenantId,
    actorType: actor.type,
    actorUserId: actor.userId ?? null,
    entityType: entity.type,
    entityId: entity.id,
    action,
    changes: (changes ?? null) as never,
    ip: actor.ip ?? null,
  });
}
