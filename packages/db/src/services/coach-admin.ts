/**
 * Coach admin (Phase 4b): everything the coach portal records, for every coach, in one board —
 * live today (stages, ETAs, needs attention, feed), checklists & ratings, the roster — plus
 * reopening a phase for a coach and maintenance tickets from damage reports.
 */
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql } from 'drizzle-orm';
import {
  coachPhase, COACH_PHASE_KEYS, COACH_PHASES, coachRating, isPhaseLocked, phaseItems, phasePercent, utcToWallTime, wallTimeToUtc,
  type CoachPhaseKey, type CoachPhotoKind,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import {
  auditLog, coachChecklists, coachPhotos, customers, inventoryPools, inventoryUnits, invitations, locations, maintenanceTickets, memberships, orderLines,
  orders, orderStaff, products, signatures, users,
} from '../schema';
import { audit, type Actor } from './audit';
import { coachStateOf } from './coach';
import { OrgError } from './errors';

const DAY = 86_400_000;
export type Stage = 'pre_departure' | 'en_route' | 'event' | 'completed';
/** A late EVENT START still counts as on time within this grace. */
export const ON_TIME_GRACE_MIN = 5;

async function photoMap(tx: Tx, tenantId: string, ids: string[]) {
  const map = new Map<string, Partial<Record<CoachPhotoKind, number>>>();
  if (!ids.length) return map;
  const rows = await tx
    .select({ orderId: coachPhotos.orderId, kind: coachPhotos.kind, n: sql<number>`count(*)::int` })
    .from(coachPhotos)
    .where(and(eq(coachPhotos.tenantId, tenantId), inArray(coachPhotos.orderId, ids)))
    .groupBy(coachPhotos.orderId, coachPhotos.kind);
  for (const r of rows) map.set(r.orderId, { ...map.get(r.orderId), [r.kind]: r.n });
  return map;
}

export type BoardOrder = Awaited<ReturnType<typeof coachBoard>>['orders'][number];

/** The whole Coaches & crew board, from 30 days back to 14 days ahead (plus anything still tracked). */
export function coachBoard(db: Db, tenantId: string, opts: { timeZone: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const today = utcToWallTime(now, opts.timeZone).date;
  const dayStart = wallTimeToUtc(today, '00:00', opts.timeZone);
  const dayEnd = new Date(dayStart.getTime() + DAY);
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: orders.id, number: orders.number, status: orders.status, startsAt: orders.eventStartsAt, endsAt: orders.eventEndsAt,
        totalCents: orders.totalCents, paidCents: orders.paidCents, eventLat: orders.eventLat, eventLng: orders.eventLng,
        line1: orders.eventLine1, city: orders.eventCity, venue: orders.eventLocationName,
        customerName: customers.displayName, locationId: locations.id, locationName: locations.name, locationLat: locations.lat, locationLng: locations.lng, tz: locations.timezone,
      })
      .from(orders)
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
      .leftJoin(coachChecklists, and(eq(coachChecklists.tenantId, orders.tenantId), eq(coachChecklists.orderId, orders.id)))
      .where(and(
        eq(orders.tenantId, tenantId),
        inArray(orders.status, ['booked', 'completed']),
        sql`exists (select 1 from order_staff s where s.tenant_id = ${orders.tenantId} and s.order_id = ${orders.id})`,
        or(and(gte(orders.eventStartsAt, new Date(now.getTime() - 30 * DAY)), lte(orders.eventStartsAt, new Date(now.getTime() + 14 * DAY))), eq(coachChecklists.tracking, true)),
      ))
      .orderBy(asc(orders.eventStartsAt));
    const ids = rows.map((r) => r.id);
    const staff = ids.length
      ? await tx.select({ orderId: orderStaff.orderId, userId: orderStaff.userId, role: orderStaff.role, isLead: orderStaff.isLead, name: users.name, image: users.image })
          .from(orderStaff).innerJoin(users, eq(users.id, orderStaff.userId))
          .where(and(eq(orderStaff.tenantId, tenantId), inArray(orderStaff.orderId, ids)))
      : [];
    const lists = ids.length ? await tx.select().from(coachChecklists).where(and(eq(coachChecklists.tenantId, tenantId), inArray(coachChecklists.orderId, ids))) : [];
    const photos = await photoMap(tx, tenantId, ids);
    const signed = new Set(ids.length ? (await tx.select({ orderId: signatures.orderId }).from(signatures).where(and(eq(signatures.tenantId, tenantId), inArray(signatures.orderId, ids)))).map((s) => s.orderId) : []);
    const tickets = ids.length
      ? await tx.select({ orderId: maintenanceTickets.orderId, number: maintenanceTickets.number, status: maintenanceTickets.status }).from(maintenanceTickets)
          .where(and(eq(maintenanceTickets.tenantId, tenantId), inArray(maintenanceTickets.orderId, ids)))
      : [];

    const list = rows.map((r) => {
      const row = lists.find((l) => l.orderId === r.id) ?? null;
      const state = coachStateOf(row, photos.get(r.id) ?? {});
      const team = staff.filter((s) => s.orderId === r.id);
      const phases = COACH_PHASE_KEYS.map((k) => ({
        key: k, percent: phasePercent(k, state), savedAt: state.saved[k] ?? null, lockedAt: state.locked[k] ?? null, reopenedAt: state.reopened[k] ?? null, locked: isPhaseLocked(k, state),
      }));
      const rating = Math.round((phases.reduce((s, p) => s + p.percent, 0) / phases.length) * 10) / 10;
      const completed = !!state.arrivedAt && phases.every((p) => p.savedAt);
      const started = !!row?.eventStartedAt || now >= r.startsAt;
      const closed = now >= r.endsAt;
      const gaps = (started && phases.some((p) => p.savedAt && p.percent < 100)) || (closed && phases.some((p) => !p.savedAt));
      const dueCents = Math.max(0, r.totalCents - r.paidCents);
      const stage: Stage = completed ? 'completed' : row?.arrivedAt ? 'event' : row?.enRouteAt ? 'en_route' : 'pre_departure';
      return {
        ...r,
        address: [r.venue, r.line1, r.city].filter(Boolean).join(', '),
        isToday: (r.startsAt < dayEnd && r.endsAt >= dayStart) || !!row?.tracking,
        lead: team.find((s) => s.isLead) ?? team.find((s) => s.role === 'coach') ?? null,
        coaches: team.filter((s) => s.role === 'coach'),
        crew: team.filter((s) => s.role === 'crew'),
        phases, rating, completed, stage, closed,
        enRouteAt: row?.enRouteAt ?? null, text1At: row?.text1At ?? null, text2At: row?.text2At ?? null, tracking: row?.tracking ?? false,
        etaMinutes: row?.etaMinutes ?? null, lastLat: row?.lastLat ?? null, lastLng: row?.lastLng ?? null, lastFixAt: row?.lastFixAt ?? null,
        arrivedAt: row?.arrivedAt ?? null, arrivedDistanceM: row?.arrivedDistanceM ?? null,
        eventStartedAt: row?.eventStartedAt ?? null, varianceMin: row?.eventStartVarianceMin ?? null,
        damage: row?.maintenanceFlag ?? false, damageNotes: row?.damageNotes ?? null,
        tickets: tickets.filter((t) => t.orderId === r.id).map((t) => ({ number: t.number, status: t.status })),
        flags: {
          damage: row?.maintenanceFlag ?? false,
          gaps,
          unsigned: !signed.has(r.id),
          dueCents,
          loadNotSaved: !state.saved.load && !row?.enRouteAt && r.startsAt.getTime() - now.getTime() < 2 * 3600_000 && !closed,
        },
      };
    });

    // --- needs attention (today, plus damage on any recent order without a ticket) -----------------
    type Attention = { kind: 'damage' | 'gaps' | 'balance' | 'unsigned' | 'load'; orderId: string; number: string; coach: string; text: string; phase: CoachPhaseKey | null };
    const attention: Attention[] = [];
    for (const o of list) {
      const coach = o.lead?.name ?? 'No coach';
      if (o.flags.damage && !o.tickets.some((t) => t.status === 'open' || t.status === 'closed')) attention.push({ kind: 'damage', orderId: o.id, number: o.number, coach, text: `Damage reported · maintenance flag on${o.damageNotes ? `: ${o.damageNotes}` : ''}`, phase: 'closeout' });
      if (!o.isToday && !o.flags.gaps) continue;
      if (o.flags.gaps) {
        const gap = o.phases.find((p) => (p.savedAt && p.percent < 100) || (o.closed && !p.savedAt));
        attention.push({ kind: 'gaps', orderId: o.id, number: o.number, coach, text: `Checklist gap: ${gap ? coachPhase(gap.key).title : 'a phase'} ${gap?.savedAt ? `saved at ${Math.round(gap.percent)}%` : 'not saved'}`, phase: gap?.key ?? null });
      }
      if (!o.isToday) continue;
      if (o.flags.dueCents > 0 && !o.completed) attention.push({ kind: 'balance', orderId: o.id, number: o.number, coach, text: 'Balance to collect on arrival', phase: 'arrival' });
      if (o.flags.unsigned && !o.arrivedAt && o.startsAt.getTime() - now.getTime() < 3 * 3600_000) attention.push({ kind: 'unsigned', orderId: o.id, number: o.number, coach, text: 'Contract not signed and departure is soon', phase: 'arrival' });
      if (o.flags.loadNotSaved) attention.push({ kind: 'load', orderId: o.id, number: o.number, coach, text: 'Load checklist not saved', phase: 'load' });
    }

    // --- live feed (today, all coaches) --------------------------------------------------------------
    const feed = ids.length
      ? await tx
          .select({ at: auditLog.at, action: auditLog.action, orderId: auditLog.entityId, changes: auditLog.changes, actor: users.name })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorUserId))
          .where(and(eq(auditLog.entityType, 'order'), inArray(auditLog.entityId, ids), like(auditLog.action, 'coach.%'), gte(auditLog.at, dayStart), sql`${auditLog.action} not in ('coach.staff','coach.notes','coach.photo_removed')`))
          .orderBy(desc(auditLog.at))
          .limit(40)
      : [];

    // --- roster ------------------------------------------------------------------------------------------
    const members = await tx
      .select({ userId: users.id, name: users.name, email: users.email, image: users.image, role: memberships.role, vehicle: memberships.vehicle, title: memberships.title, status: memberships.status })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(inArray(memberships.role, ['coach', 'crew']))
      .orderBy(asc(users.name));
    const invites = await tx
      .select({ id: invitations.id, email: invitations.email, name: invitations.name, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(inArray(invitations.role, ['coach', 'crew']), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const rated = (o: (typeof list)[number]) => o.status === 'booked' || o.status === 'completed';
    const roster = members.map((m) => {
      const mine = list.filter((o) => o.coaches.some((c) => c.userId === m.userId));
      const helped = list.filter((o) => o.crew.some((c) => c.userId === m.userId));
      const r = coachRating(mine.filter(rated).map((o) => o.rating));
      const startedOnes = mine.filter((o) => o.varianceMin != null);
      const arrivals = mine.filter((o) => o.arrivedDistanceM != null);
      const current = list.find((o) => o.isToday && !o.completed && (o.coaches.some((c) => c.userId === m.userId) || o.crew.some((c) => c.userId === m.userId))) ?? null;
      return {
        ...m,
        rating: r,
        orders: mine.length,
        fullyChecked: mine.filter((o) => o.rating >= 100).length,
        closed: mine.filter((o) => o.closed || o.completed).length,
        onTimePct: startedOnes.length ? Math.round((startedOnes.filter((o) => o.varianceMin! <= ON_TIME_GRACE_MIN).length / startedOnes.length) * 100) : null,
        avgArrivalM: arrivals.length ? Math.round(arrivals.reduce((s, o) => s + o.arrivedDistanceM!, 0) / arrivals.length) : null,
        damageReports: mine.filter((o) => o.flags.damage).length,
        helped: helped.length,
        worksWith: [...new Set(helped.map((o) => o.lead?.name).filter(Boolean))] as string[],
        current: current ? { id: current.id, number: current.number, stage: current.stage, etaMinutes: current.tracking ? current.etaMinutes : null, rating: current.rating, phases: current.phases.map((p) => p.percent), withCoach: current.lead?.name ?? null } : null,
      };
    });

    const todays = list.filter((o) => o.isToday);
    const onDutyIds = new Set(todays.flatMap((o) => [...o.coaches, ...o.crew].map((s) => s.userId)));
    const coachIds = new Set(members.filter((m) => m.role === 'coach').map((m) => m.userId));
    const allRatings = coachRating(list.filter(rated).map((o) => o.rating));
    return {
      today, dayStart,
      orders: list,
      attention,
      feed: feed.map((f) => ({ ...f, number: list.find((o) => o.id === f.orderId)?.number ?? '' })),
      roster,
      invites: invites.filter((i) => i.expiresAt > now),
      kpis: {
        onDuty: { coaches: [...onDutyIds].filter((id) => coachIds.has(id)).length, crew: [...onDutyIds].filter((id) => !coachIds.has(id)).length },
        enRoute: todays.filter((o) => o.stage === 'en_route').map((o) => ({ coach: o.lead?.name ?? '', eta: o.tracking ? o.etaMinutes : null, number: o.number })),
        atEvent: todays.filter((o) => o.stage === 'event').length,
        completedToday: todays.filter((o) => o.completed).length,
        rating: allRatings,
        flags: {
          damage: list.filter((o) => o.flags.damage && !o.tickets.length).length,
          gaps: list.filter((o) => o.flags.gaps).length,
          unsigned: todays.filter((o) => o.flags.unsigned && !o.completed).length,
        },
      },
    };
  });
}

/** The admin drawer: every item with its tick time, the photos, the extras and the tickets. */
export function adminChecklist(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    const [row] = await tx.select().from(coachChecklists).where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.orderId, orderId))).limit(1);
    const photoRows = await tx.select().from(coachPhotos).where(and(eq(coachPhotos.tenantId, tenantId), eq(coachPhotos.orderId, orderId))).orderBy(asc(coachPhotos.takenAt));
    const counts: Partial<Record<CoachPhotoKind, number>> = {};
    for (const p of photoRows) counts[p.kind as CoachPhotoKind] = (counts[p.kind as CoachPhotoKind] ?? 0) + 1;
    const state = coachStateOf(row ?? null, counts);
    const [sig] = await tx.select({ signedAt: signatures.signedAt }).from(signatures).where(and(eq(signatures.tenantId, tenantId), eq(signatures.orderId, orderId))).limit(1);
    const lines = await tx
      .select({ productId: orderLines.productId, name: orderLines.name, quantity: orderLines.quantity, tracking: products.tracking })
      .from(orderLines)
      .leftJoin(products, and(eq(products.tenantId, orderLines.tenantId), eq(products.id, orderLines.productId)))
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)));
    const productIds = lines.map((l) => l.productId).filter((p): p is string => !!p);
    const units = productIds.length
      ? await tx.select({ id: inventoryUnits.id, productId: inventoryUnits.productId, label: inventoryUnits.label, status: inventoryUnits.status })
          .from(inventoryUnits).where(and(eq(inventoryUnits.tenantId, tenantId), inArray(inventoryUnits.productId, productIds), eq(inventoryUnits.locationId, order.locationId)))
      : [];
    const tickets = await tx.select().from(maintenanceTickets).where(and(eq(maintenanceTickets.tenantId, tenantId), eq(maintenanceTickets.orderId, orderId))).orderBy(asc(maintenanceTickets.createdAt));
    const history = await tx
      .select({ at: auditLog.at, action: auditLog.action, changes: auditLog.changes, actor: users.name })
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(eq(auditLog.entityType, 'order'), eq(auditLog.entityId, orderId), inArray(auditLog.action, ['coach.reopened', 'coach.maintenance_ticket'])))
      .orderBy(desc(auditLog.at));
    return {
      order: { id: order.id, number: order.number, startsAt: order.eventStartsAt, totalCents: order.totalCents, paidCents: order.paidCents },
      phases: COACH_PHASES.map((p) => ({
        key: p.key, title: p.title, note: p.note ?? null, percent: phasePercent(p.key, state),
        savedAt: state.saved[p.key] ?? null, lockedAt: state.locked[p.key] ?? null, reopenedAt: state.reopened[p.key] ?? null, locked: isPhaseLocked(p.key, state),
        groups: p.groups.map((g) => ({ label: g.label ?? null, items: g.items.map((i) => ({ ...i, tickedAt: state.ticks[i.key] ?? null })) })),
        photo: p.photo ? { kind: p.photo.kind, label: p.photo.label } : null,
      })),
      photos: photoRows.map((p) => ({ id: p.id, kind: p.kind, fileId: p.fileId, takenAt: p.takenAt })),
      arrivedAt: row?.arrivedAt ?? null, arrivedDistanceM: row?.arrivedDistanceM ?? null,
      enRouteAt: row?.enRouteAt ?? null, text1At: row?.text1At ?? null, text2At: row?.text2At ?? null, etaMinutes: row?.etaMinutes ?? null, tracking: row?.tracking ?? false,
      eventStartedAt: row?.eventStartedAt ?? null, varianceMin: row?.eventStartVarianceMin ?? null,
      overrideReason: row?.overrideReason ?? null, sopNotes: row?.sopNotes ?? null,
      damage: row?.damage ?? false, damageNotes: row?.damageNotes ?? null, maintenanceFlag: row?.maintenanceFlag ?? false,
      contractSignedAt: sig?.signedAt ?? null,
      products: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId!, name: l.name, serialized: l.tracking === 'serialized', units: units.filter((u) => u.productId === l.productId) })),
      tickets,
      history,
      rating: Math.round((COACH_PHASE_KEYS.reduce((s, k) => s + phasePercent(k, state), 0) / 5) * 10) / 10,
    };
  });
}

/** Reopen a saved phase so the coach can correct it (needs a reason; written to the order history). */
export async function reopenCoachPhase(db: Db, tenantId: string, actor: Actor, orderId: string, phase: CoachPhaseKey, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new OrgError('Say why the phase is reopened.', 'invalid');
  return withTenant(db, tenantId, async (tx) => {
    const [o] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1).for('update');
    if (!o) throw new OrgError('Order not found.', 'not_found');
    const [row] = await tx.select().from(coachChecklists).where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.orderId, orderId))).limit(1);
    const state = coachStateOf(row ?? null);
    if (!state.saved[phase]) throw new OrgError(`${coachPhase(phase).title} has not been saved yet, so there is nothing to reopen.`, 'invalid');
    const reopened = { ...state.reopened, [phase]: new Date().toISOString() };
    await tx.update(coachChecklists)
      .set({ state: { ticks: state.ticks, saved: state.saved, locked: state.locked, reopened }, updatedAt: new Date() })
      .where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.orderId, orderId)));
    await audit(tx, tenantId, actor, { type: 'order', id: orderId }, 'coach.reopened', { phase, title: coachPhase(phase).title, reason: why.slice(0, 500) });
  });
}

/**
 * Create a maintenance ticket (MT-0001) for damaged equipment on an order: the serialized unit goes
 * to Maintenance, or one pooled unit is taken out of service, until the ticket is closed.
 */
export function createMaintenanceTicket(db: Db, tenantId: string, actor: Actor, input: { orderId: string; productId: string; unitId?: string | null; notes?: string | null }) {
  return withTenant(db, tenantId, async (tx) => {
    const [o] = await tx.select({ id: orders.id, locationId: orders.locationId }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, input.orderId))).limit(1).for('update');
    if (!o) throw new OrgError('Order not found.', 'not_found');
    const [line] = await tx.select({ name: orderLines.name }).from(orderLines)
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, o.id), eq(orderLines.productId, input.productId))).limit(1);
    if (!line) throw new OrgError('That item is not on this order.', 'invalid');
    if (input.unitId) {
      const [unit] = await tx.select().from(inventoryUnits)
        .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, input.unitId), eq(inventoryUnits.productId, input.productId), eq(inventoryUnits.locationId, o.locationId))).limit(1);
      if (!unit) throw new OrgError('That unit is not at this order’s location.', 'invalid');
      await tx.update(inventoryUnits).set({ status: 'maintenance', statusChangedAt: new Date(), updatedAt: new Date() }).where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, unit.id)));
    } else {
      const [pool] = await tx.select().from(inventoryPools)
        .where(and(eq(inventoryPools.tenantId, tenantId), eq(inventoryPools.productId, input.productId), eq(inventoryPools.locationId, o.locationId))).limit(1).for('update');
      if (pool) {
        if (pool.outOfService >= pool.quantityOwned) throw new OrgError('Every unit of this item is already out of service.', 'invalid');
        await tx.update(inventoryPools).set({ outOfService: pool.outOfService + 1 })
          .where(and(eq(inventoryPools.tenantId, tenantId), eq(inventoryPools.productId, input.productId), eq(inventoryPools.locationId, o.locationId)));
      } else {
        // No stock row means one owned (Odoo rental_quantity default): that one is now out of service.
        await tx.insert(inventoryPools).values({ tenantId, productId: input.productId, locationId: o.locationId, quantityOwned: 1, outOfService: 1 });
      }
    }
    const [{ number }] = (await tx.execute<{ number: string }>(sql`select app_next_number('maintenance_ticket', 'MT-', 4) as number`)) as unknown as [{ number: string }];
    const [ticket] = await tx.insert(maintenanceTickets).values({
      tenantId, number, orderId: o.id, productId: input.productId, locationId: o.locationId, unitId: input.unitId ?? null,
      notes: (input.notes ?? '').trim().slice(0, 2000) || null, createdByUserId: actor.userId ?? null,
    }).returning();
    await audit(tx, tenantId, actor, { type: 'order', id: o.id }, 'coach.maintenance_ticket', { number, item: line.name });
    return ticket!;
  });
}

/** Close a ticket: the unit is back in service (a serialized unit becomes Ready). */
export function closeMaintenanceTicket(db: Db, tenantId: string, actor: Actor, ticketId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [t] = await tx.select().from(maintenanceTickets).where(and(eq(maintenanceTickets.tenantId, tenantId), eq(maintenanceTickets.id, ticketId))).limit(1).for('update');
    if (!t) throw new OrgError('Ticket not found.', 'not_found');
    if (t.status === 'closed') return t;
    if (t.unitId) {
      await tx.update(inventoryUnits).set({ status: 'ready', statusChangedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, t.unitId), eq(inventoryUnits.status, 'maintenance')));
    } else {
      await tx.update(inventoryPools).set({ outOfService: sql`greatest(${inventoryPools.outOfService} - 1, 0)` })
        .where(and(eq(inventoryPools.tenantId, tenantId), eq(inventoryPools.productId, t.productId), eq(inventoryPools.locationId, t.locationId)));
    }
    const [closed] = await tx.update(maintenanceTickets).set({ status: 'closed', closedAt: new Date(), closedByUserId: actor.userId ?? null })
      .where(and(eq(maintenanceTickets.tenantId, tenantId), eq(maintenanceTickets.id, ticketId))).returning();
    if (t.orderId) await audit(tx, tenantId, actor, { type: 'order', id: t.orderId }, 'coach.maintenance_closed', { number: t.number });
    return closed!;
  });
}

export const PHASE_ITEM_COUNT = Object.fromEntries(COACH_PHASES.map((p) => [p.key, phaseItems(p).length])) as Record<CoachPhaseKey, number>;
