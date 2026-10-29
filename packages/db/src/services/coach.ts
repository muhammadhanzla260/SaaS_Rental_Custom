/**
 * Coach portal (Phase 4a): who is on an order, the five-phase checklist, en route with the two
 * customer texts, live tracking, arrival and EVENT START. Every rule from @rental/core/coach is
 * enforced here, under a lock on the order, so the phone cannot skip a gate. Each step is written
 * to the order history (audit_log, entity "order", action "coach.*").
 *
 * GPS stays out of transactions: Mapbox ETAs are fetched between a read and the write, through
 * the `eta` function the web app passes in.
 */
import { and, asc, desc, eq, inArray, like, lt, ne, sql } from 'drizzle-orm';
import {
  ARRIVING_SOON_MINUTES, canStartEnRoute, COACH_PHASE_KEYS, coachPhase, CoachRuleError, coachRating, emptyCoachState, GPS_KEEP_DAYS,
  haversineMeters, isCoachComplete, isEtaSpike, isGpsOutlier, isPhaseLocked, isPhaseOpen, orderRating, phasePercent, phaseStatus,
  savePhase, startVariance, type CoachPhaseKey, type CoachPhotoKind, type CoachState, type LatLng, type PhaseStatus,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import {
  auditLog, coachChecklists, coachGpsPings, coachPhotos, customers, files, locations, memberships, orderLines, orders, orderStaff, signatures, users,
} from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';
import { enqueueOfficeAlert, enqueueOrderMessage, ensureOrderToken, quoteUrl } from './messaging';
import { storeFile, type UploadedFile } from './organizations';

export type EtaFn = (from: LatLng, to: LatLng) => Promise<number | null>;
export type Fix = LatLng & { accuracyM?: number | null };
type Row = typeof coachChecklists.$inferSelect;

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', quote_sent: 'Quote', cancelled: 'Cancelled', completed: 'Done', booked: 'Booked' };
const PHOTO_PHASE: Record<CoachPhotoKind, CoachPhaseKey> = { load: 'load', setup: 'setup', closeout: 'closeout', damage: 'closeout' };
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const orderEntity = (orderId: string) => ({ type: 'order', id: orderId });

// --- assignment ---------------------------------------------------------------------------------

export type StaffInput = { userId: string; role: 'coach' | 'crew'; isLead?: boolean };

/** Active coaches and crew who can be put on an order. */
export function coachCandidates(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({ userId: users.id, name: users.name, email: users.email, image: users.image, role: memberships.role, vehicle: memberships.vehicle })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(inArray(memberships.role, ['coach', 'crew']), eq(memberships.status, 'active')))
      .orderBy(asc(users.name)),
  );
}

async function staffOf(tx: Tx, tenantId: string, orderIds: string[]) {
  if (!orderIds.length) return [];
  return tx
    .select({ orderId: orderStaff.orderId, userId: orderStaff.userId, role: orderStaff.role, isLead: orderStaff.isLead, name: users.name, image: users.image })
    .from(orderStaff)
    .innerJoin(users, eq(users.id, orderStaff.userId))
    .where(and(eq(orderStaff.tenantId, tenantId), inArray(orderStaff.orderId, orderIds)))
    .orderBy(desc(orderStaff.isLead), asc(users.name));
}

export function orderStaffList(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, (tx) => staffOf(tx, tenantId, [orderId]));
}

/**
 * Replace who is on an order. Coaches must be members with the Coach role; crew may be Coach or
 * Crew members. With coaches there is always exactly one lead (the first, unless one is chosen).
 */
export function setOrderStaff(db: Db, tenantId: string, actor: Actor, orderId: string, input: StaffInput[]) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1).for('update');
    if (!order) throw new OrgError('Order not found.', 'not_found');
    const seen = new Set<string>();
    const rows = input.filter((s) => (seen.has(s.userId) ? false : (seen.add(s.userId), true)));
    if (rows.length > 12) throw new OrgError('An order can have at most 12 coaches and crew.', 'invalid');
    const ids = rows.map((r) => r.userId);
    const members = ids.length
      ? await tx.select({ userId: memberships.userId, role: memberships.role, status: memberships.status }).from(memberships).where(inArray(memberships.userId, ids))
      : [];
    for (const r of rows) {
      const m = members.find((x) => x.userId === r.userId);
      if (!m || m.status !== 'active') throw new OrgError('Someone on the list is no longer an active member.', 'invalid');
      if (r.role === 'coach' && m.role !== 'coach') throw new OrgError('Only members with the Coach role can be a coach on an order.', 'invalid');
      if (r.role === 'crew' && !['coach', 'crew'].includes(m.role)) throw new OrgError('Crew must have the Coach or Crew role.', 'invalid');
    }
    const coaches = rows.filter((r) => r.role === 'coach');
    const lead = coaches.find((r) => r.isLead) ?? coaches[0];
    const before = await staffOf(tx, tenantId, [orderId]);
    await tx.delete(orderStaff).where(and(eq(orderStaff.tenantId, tenantId), eq(orderStaff.orderId, orderId)));
    if (rows.length) {
      await tx.insert(orderStaff).values(
        rows.map((r) => ({ tenantId, orderId, userId: r.userId, role: r.role, isLead: r.role === 'coach' && r.userId === lead?.userId, assignedByUserId: actor.userId ?? null })),
      );
    }
    const after = await staffOf(tx, tenantId, [orderId]);
    const label = (list: typeof after) => list.map((s) => `${s.name} (${s.isLead ? 'lead coach' : s.role})`).join(', ') || 'nobody';
    if (label(before) !== label(after)) await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.staff', { from: label(before), to: label(after) });
    return after;
  });
}

/** "Notes for coach" on an order (shown on the coach's order page). Kept out of the order form's versioning. */
export function setCoachNotes(db: Db, tenantId: string, actor: Actor, orderId: string, notes: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const value = (notes ?? '').trim().slice(0, 4000) || null;
    const [before] = await tx.select({ coachNotes: orders.coachNotes }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1).for('update');
    if (!before) throw new OrgError('Order not found.', 'not_found');
    if (before.coachNotes === value) return;
    await tx.update(orders).set({ coachNotes: value, updatedAt: new Date() }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.notes', { from: before.coachNotes, to: value });
  });
}

/** For the staff order page: who is on the order and how far the checklist is. */
export function orderCoachSummary(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const staff = await staffOf(tx, tenantId, [orderId]);
    const { row, state } = await loadState(tx, tenantId, orderId);
    const [o] = await tx.select({ coachNotes: orders.coachNotes }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1);
    return { staff, coachNotes: o?.coachNotes ?? null, checklist: checklistView(row, state) };
  });
}

// --- access -------------------------------------------------------------------------------------

/** The order, if this person is on it. Only Booked orders can be worked (Quote / Draft / Cancelled are locked). */
async function access(tx: Tx, tenantId: string, userId: string, orderId: string, need: 'view' | 'coach', lock = false) {
  const q = tx
    .select({ order: orders, staff: orderStaff })
    .from(orders)
    .innerJoin(orderStaff, and(eq(orderStaff.tenantId, orders.tenantId), eq(orderStaff.orderId, orders.id), eq(orderStaff.userId, userId)))
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  const [row] = lock ? await q.for('update', { of: orders }) : await q;
  if (!row) throw new OrgError('This order is not assigned to you.', 'not_found');
  if (row.order.status !== 'booked') {
    throw new OrgError(`Order ${row.order.number} is a ${STATUS_LABEL[row.order.status] ?? 'closed'} order. The detail page is only available for Booked orders.`, 'forbidden');
  }
  if (need === 'coach' && row.staff.role !== 'coach') throw new OrgError('Crew can see this order but only a coach runs its checklist.', 'forbidden');
  return row;
}

async function checklistRow(tx: Tx, tenantId: string, orderId: string): Promise<Row | null> {
  const [row] = await tx.select().from(coachChecklists).where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.orderId, orderId))).limit(1);
  return row ?? null;
}

async function photoCounts(tx: Tx, tenantId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Partial<Record<CoachPhotoKind, number>>>();
  const rows = await tx
    .select({ orderId: coachPhotos.orderId, kind: coachPhotos.kind, n: sql<number>`count(*)::int` })
    .from(coachPhotos)
    .where(and(eq(coachPhotos.tenantId, tenantId), inArray(coachPhotos.orderId, orderIds)))
    .groupBy(coachPhotos.orderId, coachPhotos.kind);
  const map = new Map<string, Partial<Record<CoachPhotoKind, number>>>();
  for (const r of rows) map.set(r.orderId, { ...map.get(r.orderId), [r.kind]: r.n });
  return map;
}

/** CoachState from a stored row (no row yet = nothing done). */
export function coachStateOf(row: Row | null, photos: Partial<Record<CoachPhotoKind, number>> = {}): CoachState {
  const j = (row?.state ?? {}) as Partial<Pick<CoachState, 'ticks' | 'saved' | 'locked' | 'reopened'>>;
  return {
    ...emptyCoachState(),
    ticks: j.ticks ?? {},
    saved: j.saved ?? {},
    locked: j.locked ?? {},
    reopened: j.reopened ?? {},
    photos,
    arrivedAt: row?.arrivedAt?.toISOString() ?? null,
    eventStartedAt: row?.eventStartedAt?.toISOString() ?? null,
  };
}

async function loadState(tx: Tx, tenantId: string, orderId: string) {
  const row = await checklistRow(tx, tenantId, orderId);
  const photos = (await photoCounts(tx, tenantId, [orderId])).get(orderId) ?? {};
  return { row, state: coachStateOf(row, photos) };
}

async function writeChecklist(tx: Tx, tenantId: string, orderId: string, set: Partial<typeof coachChecklists.$inferInsert>) {
  await tx
    .insert(coachChecklists)
    .values({ tenantId, orderId, ...set })
    .onConflictDoUpdate({ target: [coachChecklists.tenantId, coachChecklists.orderId], set: { ...set, updatedAt: new Date() } });
}

const stateJson = (s: CoachState) => ({ ticks: s.ticks, saved: s.saved, locked: s.locked, reopened: s.reopened });

function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CoachRuleError) throw new OrgError(e.message, 'invalid');
    throw e;
  }
}

async function leadCoachName(tx: Tx, tenantId: string, orderId: string, fallbackUserId: string | null | undefined) {
  const staff = await staffOf(tx, tenantId, [orderId]);
  const lead = staff.find((s) => s.isLead) ?? staff.find((s) => s.userId === fallbackUserId);
  if (lead) return lead.name;
  if (!fallbackUserId) return 'your coach';
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, fallbackUserId)).limit(1);
  return u?.name ?? 'your coach';
}

// --- the phone portal: lists and detail ---------------------------------------------------------

export type CoachOrderSummary = Awaited<ReturnType<typeof coachOrders>>[number];

/** Every order this person is on, newest event first, with checklist progress. */
export function coachOrders(db: Db, tenantId: string, userId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: orders.id, number: orders.number, status: orders.status, eventStartsAt: orders.eventStartsAt, eventEndsAt: orders.eventEndsAt,
        totalCents: orders.totalCents, paidCents: orders.paidCents, eventCity: orders.eventCity, eventLocationName: orders.eventLocationName, eventLine1: orders.eventLine1,
        customerName: customers.displayName, locationName: locations.name, timezone: locations.timezone, role: orderStaff.role, isLead: orderStaff.isLead,
      })
      .from(orderStaff)
      .innerJoin(orders, and(eq(orders.tenantId, orderStaff.tenantId), eq(orders.id, orderStaff.orderId)))
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
      .where(and(eq(orderStaff.tenantId, tenantId), eq(orderStaff.userId, userId)))
      .orderBy(desc(orders.eventStartsAt));
    const ids = rows.map((r) => r.id);
    const lists = ids.length ? await tx.select().from(coachChecklists).where(and(eq(coachChecklists.tenantId, tenantId), inArray(coachChecklists.orderId, ids))) : [];
    const photos = await photoCounts(tx, tenantId, ids);
    return rows.map((r) => {
      const row = lists.find((l) => l.orderId === r.id) ?? null;
      const state = coachStateOf(row, photos.get(r.id) ?? {});
      const completed = r.status === 'booked' && isCoachComplete(state);
      return {
        ...r,
        address: [r.eventLocationName, r.eventLine1, r.eventCity].filter(Boolean).join(', '),
        statusLabel: completed ? 'Completed' : STATUS_LABEL[r.status] ?? r.status,
        workable: r.status === 'booked',
        completed,
        rating: orderRating(state),
        phases: COACH_PHASE_KEYS.map((k) => phasePercent(k, state)),
        enRouteAt: row?.enRouteAt ?? null,
        tracking: row?.tracking ?? false,
        etaMinutes: row?.etaMinutes ?? null,
        text1At: row?.text1At ?? null,
        text2At: row?.text2At ?? null,
        arrivedAt: row?.arrivedAt ?? null,
        loadSaved: !!state.saved.load,
        enRouteReady: canStartEnRoute(state),
      };
    });
  });
}

/** The dashboard: the orders, rating, what is en route, today's schedule and recent activity. */
export async function coachHome(db: Db, tenantId: string, userId: string, timeZone: string) {
  const list = await coachOrders(db, tenantId, userId);
  const rated = list.filter((o) => o.status === 'booked' || o.status === 'completed');
  const rating = coachRating(rated.map((o) => o.rating));
  const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = dayOf(new Date());
  const todays = list.filter((o) => dayOf(o.eventStartsAt) === today || (o.eventStartsAt <= new Date() && o.eventEndsAt >= new Date()));
  const ids = list.map((o) => o.id);
  const activity = ids.length
    ? await withTenant(db, tenantId, (tx) =>
        tx
          .select({ at: auditLog.at, action: auditLog.action, orderId: auditLog.entityId, changes: auditLog.changes })
          .from(auditLog)
          .where(and(eq(auditLog.entityType, 'order'), inArray(auditLog.entityId, ids), like(auditLog.action, 'coach.%'), ne(auditLog.action, 'coach.staff')))
          .orderBy(desc(auditLog.at))
          .limit(8),
      )
    : [];
  const avg = (i: number) => (rated.length ? Math.round(rated.reduce((s, o) => s + o.phases[i]!, 0) / rated.length) : 0);
  return {
    orders: list,
    rating: { ...rating, fullyChecked: rated.filter((o) => o.rating >= 100).length, enRouteNow: list.filter((o) => o.tracking).length },
    enRoute: list.find((o) => o.tracking) ?? list.find((o) => o.enRouteAt && !o.arrivedAt && o.workable) ?? null,
    counts: {
      total: list.length,
      booked: list.filter((o) => o.status === 'booked' && !o.completed).length,
      quotes: list.filter((o) => o.status === 'quote_sent').length,
      drafts: list.filter((o) => o.status === 'draft').length,
      completed: list.filter((o) => o.completed || o.status === 'completed').length,
      cancelled: list.filter((o) => o.status === 'cancelled').length,
    },
    today: todays.sort((a, b) => a.eventStartsAt.getTime() - b.eventStartsAt.getTime()),
    phaseAverages: COACH_PHASE_KEYS.map((_, i) => avg(i)),
    activity: activity.map((a) => ({ ...a, number: list.find((o) => o.id === a.orderId)?.number ?? '' })),
  };
}

/** One order on the phone: everything the coach needs, or a lock for non-Booked orders. */
export function coachOrderDetail(db: Db, tenantId: string, userId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const { order, staff } = await access(tx, tenantId, userId, orderId, 'view');
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, order.customerId))).limit(1);
    const [location] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, order.locationId))).limit(1);
    const lines = await tx
      .select({ name: orderLines.name, quantity: orderLines.quantity, lineTotalCents: orderLines.lineTotalCents, serviceMode: orderLines.serviceMode })
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)))
      .orderBy(asc(orderLines.sort));
    const [signed] = await tx.select({ signedAt: signatures.signedAt }).from(signatures).where(and(eq(signatures.tenantId, tenantId), eq(signatures.orderId, orderId))).limit(1);
    const { row, state } = await loadState(tx, tenantId, orderId);
    const photos = await tx
      .select({ id: coachPhotos.id, kind: coachPhotos.kind, fileId: coachPhotos.fileId, takenAt: coachPhotos.takenAt })
      .from(coachPhotos)
      .where(and(eq(coachPhotos.tenantId, tenantId), eq(coachPhotos.orderId, orderId)))
      .orderBy(asc(coachPhotos.takenAt));
    const team = await staffOf(tx, tenantId, [orderId]);
    const contractUrl = signed ? null : quoteUrl(await ensureOrderToken(tx, tenantId, orderId));
    const billing = (order.billing ?? {}) as { name?: string; email?: string; phone?: string };
    return {
      order: {
        id: order.id, number: order.number, status: order.status, eventStartsAt: order.eventStartsAt, eventEndsAt: order.eventEndsAt,
        eventType: order.eventType, eventLat: order.eventLat, eventLng: order.eventLng,
        address: [order.eventLocationName, order.eventLine1, order.eventLine2, [order.eventCity, order.eventRegion, order.eventPostalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        setupSurface: order.setupSurface, coachNotes: order.coachNotes, customerNotes: order.customerNotes, setupMapFileId: order.setupMapFileId,
        totals: {
          merchandiseCents: order.merchandiseCents, extrasCents: order.extrasCents, discountCents: order.discountCents, taxCents: order.taxCents,
          totalCents: order.totalCents, depositDueCents: order.depositDueCents, paidCents: order.paidCents, dueCents: Math.max(0, order.totalCents - order.paidCents),
        },
        summary: order.summary,
      },
      customer: { name: billing.name || customer?.displayName || '', phone: billing.phone || customer?.phone || null, email: billing.email || customer?.email || null },
      contact: { name: order.eventContactName, mobile: order.eventContactMobile, email: order.eventContactEmail },
      location: location ? { name: location.name, timezone: location.timezone, lat: location.lat, lng: location.lng, loadingNotes: location.loadingNotes } : null,
      lines,
      contract: { signedAt: signed?.signedAt ?? null, url: contractUrl },
      me: { role: staff.role as 'coach' | 'crew', isLead: staff.isLead },
      team,
      checklist: checklistView(row, state),
      photos,
    };
  });
}

export type CoachChecklistView = ReturnType<typeof checklistView>;

function checklistView(row: Row | null, state: CoachState) {
  return {
    state,
    phases: COACH_PHASE_KEYS.map((k) => ({ key: k, percent: phasePercent(k, state), status: phaseStatus(k, state) as PhaseStatus, open: isPhaseOpen(k, state), locked: isPhaseLocked(k, state) })),
    rating: orderRating(state),
    completed: isCoachComplete(state),
    enRouteReady: canStartEnRoute(state),
    overrideReason: row?.overrideReason ?? null,
    sopNotes: row?.sopNotes ?? null,
    damage: row?.damage ?? false,
    damageNotes: row?.damageNotes ?? null,
    maintenanceFlag: row?.maintenanceFlag ?? false,
    enRouteAt: row?.enRouteAt ?? null,
    tracking: row?.tracking ?? false,
    etaMinutes: row?.etaMinutes ?? null,
    lastFixAt: row?.lastFixAt ?? null,
    text1At: row?.text1At ?? null,
    text2At: row?.text2At ?? null,
    arrivedAt: row?.arrivedAt ?? null,
    arrivedDistanceM: row?.arrivedDistanceM ?? null,
    eventStartedAt: row?.eventStartedAt ?? null,
    eventStartVarianceMin: row?.eventStartVarianceMin ?? null,
  };
}

// --- saving phases and photos -----------------------------------------------------------------------

export type PhaseSaveInput = {
  phase: CoachPhaseKey;
  ticked: string[];
  overrideReason?: string | null;
  sopNotes?: string | null;
  damage?: boolean;
  damageNotes?: string | null;
};

/** Save a phase (partial saves allowed). Close-Out with damage turns the maintenance flag on and alerts the office. */
export function saveCoachPhase(db: Db, tenantId: string, actor: Actor, orderId: string, input: PhaseSaveInput) {
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const { row, state } = await loadState(tx, tenantId, orderId);
    const now = new Date().toISOString();
    const next = rule(() => savePhase(input.phase, state, input.ticked, now));
    const set: Partial<typeof coachChecklists.$inferInsert> = { state: stateJson(next) };
    const clean = (s: string | null | undefined) => (s ?? '').trim().slice(0, 2000) || null;
    if (input.phase === 'arrival') set.overrideReason = clean(input.overrideReason);
    if (input.phase === 'setup') set.sopNotes = clean(input.sopNotes);
    let newDamage = false;
    if (input.phase === 'closeout') {
      const notes = clean(input.damageNotes);
      const damage = !!input.damage || !!notes || (state.photos.damage ?? 0) > 0 || !!row?.damage;
      set.damage = damage;
      set.damageNotes = notes ?? row?.damageNotes ?? null;
      if (damage && !row?.maintenanceFlag) {
        set.maintenanceFlag = true;
        newDamage = true;
      }
    }
    await writeChecklist(tx, tenantId, orderId, set);
    const percent = phasePercent(input.phase, next);
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.phase_saved', {
      phase: input.phase, title: coachPhase(input.phase).title, percent, ticked: Object.keys(next.ticks).filter((k) => !state.ticks[k]).length,
    });
    if (newDamage) {
      const coachName = await leadCoachName(tx, tenantId, orderId, userId);
      await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.damage', { notes: set.damageNotes });
      await enqueueOfficeAlert(tx, tenantId, 'damage_report', `${orderId}:damage_report`, orderId, {
        reason: set.damageNotes || 'Damage was ticked at close-out (no notes).', coachName,
      });
    }
    return { percent, locked: isPhaseLocked(input.phase, next), completed: isCoachComplete(next), damageAlert: newDamage };
  });
}

/** Add a required photo (or a damage photo). Its phase must be open and not locked. */
export function addCoachPhoto(db: Db, tenantId: string, actor: Actor, orderId: string, kind: CoachPhotoKind, file: UploadedFile, takenAt?: Date | null) {
  if (!PHOTO_MIME.includes(file.mime)) throw new OrgError('Upload a photo (JPG, PNG, WebP or HEIC).', 'invalid');
  if (file.bytes.length > PHOTO_MAX_BYTES) throw new OrgError('Photos must be 10 MB or smaller.', 'invalid');
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const { state } = await loadState(tx, tenantId, orderId);
    const phase = PHOTO_PHASE[kind];
    if (!isPhaseOpen(phase, state)) throw new OrgError(`${coachPhase(phase).title} is not open yet.`, 'invalid');
    if (isPhaseLocked(phase, state)) throw new OrgError(`${coachPhase(phase).title} is saved at 100% and locked.`, 'invalid');
    const fileId = await storeFile(tx, tenantId, userId, file, 'coach_photo', false);
    // An offline phone sends when the photo was taken; anything odd falls back to now.
    const now = Date.now();
    const at = takenAt && takenAt.getTime() <= now + 60_000 && takenAt.getTime() > now - 7 * 86_400_000 ? takenAt : new Date();
    const [photo] = await tx.insert(coachPhotos).values({ tenantId, orderId, kind, fileId, takenAt: at, uploadedByUserId: userId }).returning();
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.photo', { kind });
    return photo!;
  });
}

/** Remove a photo while its phase is still open for changes. */
export function removeCoachPhoto(db: Db, tenantId: string, actor: Actor, orderId: string, photoId: string) {
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const [photo] = await tx.select().from(coachPhotos).where(and(eq(coachPhotos.tenantId, tenantId), eq(coachPhotos.id, photoId), eq(coachPhotos.orderId, orderId))).limit(1);
    if (!photo) throw new OrgError('That photo is already gone.', 'not_found');
    const { state } = await loadState(tx, tenantId, orderId);
    const phase = PHOTO_PHASE[photo.kind as CoachPhotoKind];
    if (isPhaseLocked(phase, state)) throw new OrgError(`${coachPhase(phase).title} is saved at 100% and locked.`, 'invalid');
    await tx.delete(coachPhotos).where(and(eq(coachPhotos.tenantId, tenantId), eq(coachPhotos.id, photoId)));
    await tx.delete(files).where(and(eq(files.tenantId, tenantId), eq(files.id, photo.fileId)));
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.photo_removed', { kind: photo.kind });
  });
}

// --- en route, live tracking, arrival, EVENT START ----------------------------------------------------

/** Queue Text 2 ("about 5 minutes away") once, and stop tracking. Returns true when queued now. */
async function maybeText2(tx: Tx, tenantId: string, orderId: string, row: Pick<Row, 'text2At'> | null, eta: number | null, userId: string) {
  if (row?.text2At || eta == null || eta <= 0 || eta > ARRIVING_SOON_MINUTES) return false;
  const coachName = await leadCoachName(tx, tenantId, orderId, userId);
  await enqueueOrderMessage(tx, tenantId, orderId, 'coach_arriving', `${orderId}:coach_arriving`, {
    automatic: false, honourSwitch: true, channel: 'sms', meta: { coachName, etaMinutes: eta },
  });
  await writeChecklist(tx, tenantId, orderId, { text2At: new Date(), tracking: false });
  return true;
}

/** Only one order is tracked at a time per coach: starting another stops the rest. */
async function stopOtherTracking(tx: Tx, tenantId: string, userId: string, orderId: string) {
  await tx
    .update(coachChecklists)
    .set({ tracking: false, updatedAt: new Date() })
    .where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.enRouteByUserId, userId), eq(coachChecklists.tracking, true), ne(coachChecklists.orderId, orderId)));
}

async function destinationOf(db: Db, tenantId: string, userId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const { order } = await access(tx, tenantId, userId, orderId, 'coach');
    const { row, state } = await loadState(tx, tenantId, orderId);
    const dest = order.eventLat != null && order.eventLng != null ? { lat: order.eventLat, lng: order.eventLng } : null;
    return { order, row, state, dest };
  });
}

const safeEta = async (eta: EtaFn, from: LatLng | null, to: LatLng | null) => (from && to ? eta(from, to).catch(() => null) : null);

/**
 * Start En Route (locked until Pre-Departure and Load are saved): records the fix and ETA, starts
 * live tracking, and queues Text 1 to the customer once. An ETA of 5 minutes or less also sends Text 2.
 */
export async function startEnRoute(db: Db, tenantId: string, actor: Actor, orderId: string, fix: Fix | null, eta: EtaFn) {
  const userId = actor.userId!;
  const pre = await destinationOf(db, tenantId, userId, orderId);
  if (!canStartEnRoute(pre.state)) throw new OrgError('Start En Route unlocks once Pre-Departure and Load are saved.', 'invalid');
  if (pre.row?.arrivedAt) throw new OrgError('You have already arrived at this event.', 'invalid');
  const etaMinutes = await safeEta(eta, fix, pre.dest);
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const row = await checklistRow(tx, tenantId, orderId);
    await stopOtherTracking(tx, tenantId, userId, orderId);
    const now = new Date();
    await writeChecklist(tx, tenantId, orderId, {
      enRouteAt: row?.enRouteAt ?? now, enRouteByUserId: userId, tracking: !row?.text2At,
      ...(fix ? { lastLat: fix.lat, lastLng: fix.lng, lastFixAt: now } : {}),
      ...(etaMinutes != null ? { etaMinutes } : {}),
    });
    if (fix) await tx.insert(coachGpsPings).values({ tenantId, orderId, userId, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, etaMinutes });
    let text1 = false;
    if (!row?.text1At) {
      const coachName = await leadCoachName(tx, tenantId, orderId, userId);
      await enqueueOrderMessage(tx, tenantId, orderId, 'coach_en_route', `${orderId}:coach_en_route`, {
        automatic: false, honourSwitch: true, channel: 'sms', meta: { coachName, etaMinutes },
      });
      await writeChecklist(tx, tenantId, orderId, { text1At: now });
      text1 = true;
    }
    const text2 = await maybeText2(tx, tenantId, orderId, row, etaMinutes, userId);
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.en_route', { etaMinutes, text1, text2 });
    return { etaMinutes, text1, text2, tracking: !text2 && !row?.text2At };
  });
}

export type PingResult = { tracking: boolean; etaMinutes: number | null; text2: boolean; stopped?: 'arrived' | 'text2' | 'not_tracking'; ignored?: 'outlier' | 'eta_spike' };

/** A live GPS fix while en route (every 25 s): updates the ETA; at 5 minutes or less sends Text 2 and stops. */
export async function trackPing(db: Db, tenantId: string, actor: Actor, orderId: string, fix: Fix, eta: EtaFn): Promise<PingResult> {
  const userId = actor.userId!;
  const pre = await destinationOf(db, tenantId, userId, orderId);
  const r = pre.row;
  if (r?.arrivedAt) return { tracking: false, etaMinutes: r.etaMinutes, text2: !!r.text2At, stopped: 'arrived' };
  if (r?.text2At) return { tracking: false, etaMinutes: r.etaMinutes, text2: true, stopped: 'text2' };
  if (!r?.enRouteAt || !r.tracking) return { tracking: false, etaMinutes: r?.etaMinutes ?? null, text2: false, stopped: 'not_tracking' };
  const now = new Date();
  const prev = r.lastLat != null && r.lastLng != null && r.lastFixAt ? { lat: r.lastLat, lng: r.lastLng, at: r.lastFixAt } : null;
  const record = (ignored: string | null, etaMinutes: number | null) =>
    withTenant(db, tenantId, (tx) => tx.insert(coachGpsPings).values({ tenantId, orderId, userId, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, etaMinutes, ignored }));
  if (isGpsOutlier(prev, fix, now, fix.accuracyM)) {
    await record('outlier', null);
    return { tracking: true, etaMinutes: r.etaMinutes, text2: false, ignored: 'outlier' };
  }
  const etaMinutes = await safeEta(eta, fix, pre.dest);
  if (etaMinutes != null && pre.dest && prev) {
    if (isEtaSpike(r.etaMinutes, etaMinutes, haversineMeters(prev, pre.dest), haversineMeters(fix, pre.dest))) {
      await record('eta_spike', etaMinutes);
      return { tracking: true, etaMinutes: r.etaMinutes, text2: false, ignored: 'eta_spike' };
    }
  }
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const row = await checklistRow(tx, tenantId, orderId);
    // Tracking may have stopped meanwhile (arrived, Stop Tracking, another order started).
    if (!row?.tracking || row.arrivedAt || row.text2At) return { tracking: false, etaMinutes: row?.etaMinutes ?? null, text2: !!row?.text2At, stopped: 'not_tracking' as const };
    await writeChecklist(tx, tenantId, orderId, { lastLat: fix.lat, lastLng: fix.lng, lastFixAt: now, ...(etaMinutes != null ? { etaMinutes } : {}) });
    await tx.insert(coachGpsPings).values({ tenantId, orderId, userId, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, etaMinutes });
    const text2 = await maybeText2(tx, tenantId, orderId, row, etaMinutes, userId);
    if (text2) await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.arriving', { etaMinutes });
    return { tracking: !text2, etaMinutes: etaMinutes ?? row.etaMinutes, text2 };
  });
}

/** Stop Tracking (stays en route), or Start Tracking again: refused after Text 2 or after arrival. */
export function setTracking(db: Db, tenantId: string, actor: Actor, orderId: string, on: boolean) {
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    await access(tx, tenantId, userId, orderId, 'coach', true);
    const row = await checklistRow(tx, tenantId, orderId);
    if (!row?.enRouteAt) throw new OrgError('Press Start En Route first.', 'invalid');
    if (on) {
      if (row.arrivedAt) throw new OrgError('Tracking can’t restart after you have arrived.', 'invalid');
      if (row.text2At) throw new OrgError('Tracking can’t restart after the 5-minute text was sent.', 'invalid');
      await stopOtherTracking(tx, tenantId, userId, orderId);
    }
    if (row.tracking === on) return { tracking: on };
    await writeChecklist(tx, tenantId, orderId, { tracking: on, enRouteByUserId: userId });
    await audit(tx, tenantId, actor, orderEntity(orderId), on ? 'coach.tracking_on' : 'coach.tracking_off', {});
    return { tracking: on };
  });
}

/** "I have arrived": time and distance from the venue, tracking off, Phase 3 opens, Phase 4 counts as saved. */
export function markArrived(db: Db, tenantId: string, actor: Actor, orderId: string, fix: Fix | null) {
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    const { order } = await access(tx, tenantId, userId, orderId, 'coach', true);
    const { row, state } = await loadState(tx, tenantId, orderId);
    if (row?.arrivedAt) return { arrivedAt: row.arrivedAt, distanceM: row.arrivedDistanceM };
    const now = new Date();
    const dest = order.eventLat != null && order.eventLng != null ? { lat: order.eventLat, lng: order.eventLng } : null;
    const distanceM = fix && dest ? haversineMeters(fix, dest) : null;
    const saved = { ...state.saved, setup: state.saved.setup ?? now.toISOString() };
    await writeChecklist(tx, tenantId, orderId, {
      arrivedAt: now, arrivedLat: fix?.lat ?? null, arrivedLng: fix?.lng ?? null, arrivedDistanceM: distanceM, tracking: false,
      state: stateJson({ ...state, saved }),
    });
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.arrived', { distanceM });
    return { arrivedAt: now, distanceM };
  });
}

/** EVENT START (once, in Phase 4): the time, the GPS and how far off the scheduled start it is. */
export function eventStart(db: Db, tenantId: string, actor: Actor, orderId: string, fix: Fix | null) {
  const userId = actor.userId!;
  return withTenant(db, tenantId, async (tx) => {
    const { order } = await access(tx, tenantId, userId, orderId, 'coach', true);
    const { row, state } = await loadState(tx, tenantId, orderId);
    if (row?.eventStartedAt) throw new OrgError('EVENT START was already pressed for this event.', 'invalid');
    if (!isPhaseOpen('setup', state)) throw new OrgError('EVENT START is in Setup & Event Start, which opens after Arrival Checks are saved.', 'invalid');
    const now = new Date();
    const variance = startVariance(order.eventStartsAt, now);
    await writeChecklist(tx, tenantId, orderId, { eventStartedAt: now, eventStartLat: fix?.lat ?? null, eventStartLng: fix?.lng ?? null, eventStartVarianceMin: variance.minutes });
    await audit(tx, tenantId, actor, orderEntity(orderId), 'coach.event_start', { varianceMin: variance.minutes, label: variance.label });
    return { eventStartedAt: now, variance };
  });
}

/** The phone's tracking after the app reopens: the one order still being tracked for this coach, if any. */
export function activeTracking(db: Db, tenantId: string, userId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ orderId: coachChecklists.orderId, etaMinutes: coachChecklists.etaMinutes, number: orders.number })
      .from(coachChecklists)
      .innerJoin(orders, and(eq(orders.tenantId, coachChecklists.tenantId), eq(orders.id, coachChecklists.orderId)))
      .where(and(eq(coachChecklists.tenantId, tenantId), eq(coachChecklists.enRouteByUserId, userId), eq(coachChecklists.tracking, true), eq(orders.status, 'booked')))
      .orderBy(desc(coachChecklists.enRouteAt))
      .limit(1);
    return row ?? null;
  });
}

/** Worker housekeeping: GPS pings older than 90 days are deleted (owner connection, all workspaces). */
export async function purgeOldGpsPings(ownerDb: Db) {
  const cutoff = new Date(Date.now() - GPS_KEEP_DAYS * 86_400_000);
  const gone = await ownerDb.delete(coachGpsPings).where(lt(coachGpsPings.at, cutoff)).returning({ id: coachGpsPings.id });
  return gone.length;
}
