/**
 * The coach checklist (FreedomFun Coach Flow, Odoo freedomfun_coach_portal): five phases with the
 * guide's exact wording, how far each one is, which ones are open, and the GPS rules for en route.
 * Pure functions, shared by the server (which enforces every rule) and the phone portal.
 */

export const COACH_PHASE_KEYS = ['pre_departure', 'load', 'arrival', 'setup', 'closeout'] as const;
export type CoachPhaseKey = (typeof COACH_PHASE_KEYS)[number];
export type CoachPhotoKind = 'load' | 'setup' | 'closeout' | 'damage';

export type CoachItem = { key: string; label: string };
export type CoachPhase = {
  key: CoachPhaseKey;
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  short: string;
  button: string;
  note?: string;
  groups: { label?: string; items: CoachItem[] }[];
  /** The photo this phase needs (counts as one item in its %). */
  photo?: { kind: CoachPhotoKind; label: string };
};

export const COACH_PHASES: readonly CoachPhase[] = [
  {
    key: 'pre_departure', n: 1, title: 'Pre-Departure Readiness Checks', short: 'Pre-Departure', button: 'Save Pre-Departure',
    groups: [{ items: [
      { key: 'vehicle_fueled', label: 'Vehicle fueled & inspected' },
      { key: 'route_planned', label: 'Route planned, traffic checked' },
      { key: 'event_reviewed', label: 'Event details reviewed (address, time, contact)' },
      { key: 'uniform_clean', label: 'Uniform clean & professional' },
      { key: 'tools_packed', label: 'Tools & supplies packed' },
      { key: 'special_requests', label: 'Customer special requests noted' },
      { key: 'marketing_packed', label: 'Marketing materials for event packed (Review Cards, flyers, branding)' },
    ] }],
  },
  {
    key: 'load', n: 2, title: 'Load Checklist', short: 'Load', button: 'Save Load Checklist',
    note: 'Last gate before En Route. Confirm equipment + spares for THIS job are in the vehicle, with photo proof.',
    groups: [{ items: [
      { key: 'equipment_loaded', label: 'ALL job-specific equipment physically in vehicle (blowers, stakes, unit, gear)' },
      { key: 'spares_loaded', label: 'SPARES of critical equipment loaded: failure backup (e.g. extra laser tag guns, blowers, projectors, mixer boxes; varies by event type)' },
    ] }],
    photo: { kind: 'load', label: 'Photo of loaded equipment' },
  },
  {
    key: 'arrival', n: 3, title: 'Arrival Checks', short: 'Arrival', button: 'Save Arrival Checks',
    groups: [{ items: [
      { key: 'arrival_greeting', label: 'Warm greeting + welcome script (wish birthday child happy birthday)' },
      { key: 'arrival_contract', label: 'Review contract: if NOT already e-signed, capture digital signature on site' },
      { key: 'arrival_payment', label: 'Payment check: if balance unpaid → prompt to COLLECT on arrival' },
      { key: 'arrival_review_card', label: 'Hand customer the Review Card ("This is how my manager grades me")' },
      { key: 'arrival_safety_sheets', label: 'Inflatable drop-offs: hand customer the safety sheets' },
      { key: 'arrival_setup_location', label: 'Confirm setup location with customer' },
    ] }],
  },
  {
    key: 'setup', n: 4, title: 'Setup & Event Start', short: 'Setup', button: 'Save Setup Checklist',
    note: 'After Arrival Checks: notify that you reached the destination, set up equipment with photo proof, then press EVENT START to capture time and GPS.',
    groups: [{ label: 'Equipment setup', items: [{ key: 'setup_equipment', label: 'Equipment set up, tested & safe (spacing, visibility, flow)' }] }],
    photo: { kind: 'setup', label: 'Setup ready photo' },
  },
  {
    key: 'closeout', n: 5, title: 'On-Site Close-Out', short: 'Close-Out', button: 'Save Close-Out',
    groups: [
      { label: 'Equipment breakdown', items: [{ key: 'closeout_breakdown', label: 'Equipment breakdown completed safely' }] },
      { label: 'Site cleaned', items: [
        { key: 'closeout_site_cleaned', label: 'Site cleaned' },
        { key: 'closeout_inspected', label: 'Inspected (trash, equipment)' },
        { key: 'closeout_equipment_in_vehicle', label: 'All equipment visually back in vehicle' },
      ] },
      { label: 'Departing checks', items: [
        { key: 'closeout_thank_customer', label: 'Thank birthday child & customer' },
        { key: 'closeout_review_card', label: 'Collect completed Review Card back' },
      ] },
    ],
    photo: { kind: 'closeout', label: 'Close-out photo proof' },
  },
];

export const coachPhase = (key: CoachPhaseKey) => COACH_PHASES.find((p) => p.key === key)!;
export const phaseItems = (p: CoachPhase) => p.groups.flatMap((g) => g.items);
const ITEM_PHASE = new Map(COACH_PHASES.flatMap((p) => phaseItems(p).map((i) => [i.key, p.key] as const)));
export const itemPhase = (itemKey: string) => ITEM_PHASE.get(itemKey);

/** What the server keeps for one order's checklist (times are ISO strings). */
export type CoachState = {
  /** Item key → when it was saved ticked. A saved tick is final. */
  ticks: Record<string, string>;
  /** Phase → when it was last saved. */
  saved: Partial<Record<CoachPhaseKey, string>>;
  /** Phase → when it was saved at 100% (locked from then on). */
  locked: Partial<Record<CoachPhaseKey, string>>;
  /** Phase → when an admin reopened it (newer than its lock = editable again). */
  reopened: Partial<Record<CoachPhaseKey, string>>;
  /** How many photos of each kind are on the order. */
  photos: Partial<Record<CoachPhotoKind, number>>;
  arrivedAt: string | null;
  eventStartedAt: string | null;
};

export const emptyCoachState = (): CoachState => ({ ticks: {}, saved: {}, locked: {}, reopened: {}, photos: {}, arrivedAt: null, eventStartedAt: null });

/** (ticked items + required photo present) ÷ (items + 1 when a photo is required), as 0–100. */
export function phasePercent(key: CoachPhaseKey, s: CoachState) {
  const p = coachPhase(key);
  const items = phaseItems(p);
  const done = items.filter((i) => s.ticks[i.key]).length + (p.photo && (s.photos[p.photo.kind] ?? 0) > 0 ? 1 : 0);
  const total = items.length + (p.photo ? 1 : 0);
  return Math.round((done / total) * 1000) / 10;
}

/** Order rating: the average of the five phase percentages. */
export function orderRating(s: CoachState) {
  return Math.round((COACH_PHASE_KEYS.reduce((sum, k) => sum + phasePercent(k, s), 0) / COACH_PHASE_KEYS.length) * 10) / 10;
}

export const isPhaseSaved = (key: CoachPhaseKey, s: CoachState) => !!s.saved[key];

/** Phase 1 is always open; each later one opens when the one before is open and saved; Phase 3 also waits for "I have arrived". */
export function isPhaseOpen(key: CoachPhaseKey, s: CoachState): boolean {
  switch (key) {
    case 'pre_departure': return true;
    case 'load': return isPhaseSaved('pre_departure', s);
    case 'arrival': return !!s.arrivedAt && isPhaseOpen('load', s) && isPhaseSaved('load', s);
    case 'setup': return isPhaseOpen('arrival', s) && isPhaseSaved('arrival', s);
    case 'closeout': return isPhaseOpen('setup', s) && isPhaseSaved('setup', s);
  }
}

/** Saved at 100% and not reopened since: nothing more to do. (Reaching 100% only locks on Save.) */
export function isPhaseLocked(key: CoachPhaseKey, s: CoachState) {
  const locked = s.locked[key];
  if (!locked) return false;
  const reopened = s.reopened[key];
  return !(reopened && reopened > locked);
}

export type PhaseStatus =
  | { kind: 'open' }
  | { kind: 'saved'; at: string; locked: boolean }
  | { kind: 'saved_on_arrival'; at: string }
  | { kind: 'reopened'; at: string }
  | { kind: 'locked_until'; phase: number }
  | { kind: 'after_arrival' };

/** The state shown on a phase tile ("Open", "Saved", "Locked until phase 2 is saved", …). */
export function phaseStatus(key: CoachPhaseKey, s: CoachState): PhaseStatus {
  if (!isPhaseOpen(key, s)) {
    if (key === 'arrival' && isPhaseSaved('load', s) && !s.arrivedAt) return { kind: 'after_arrival' };
    const n = coachPhase(key).n;
    const blocker = COACH_PHASES.slice(0, n - 1).find((p) => !isPhaseSaved(p.key, s));
    if (!blocker && key !== 'pre_departure') return { kind: 'after_arrival' };
    return { kind: 'locked_until', phase: blocker?.n ?? n - 1 };
  }
  const saved = s.saved[key];
  const reopened = s.reopened[key];
  if (reopened && (!s.locked[key] || reopened > s.locked[key]!) && (!saved || reopened > saved)) return { kind: 'reopened', at: reopened };
  if (!saved) return { kind: 'open' };
  // Setup counts as saved once the coach has arrived (Odoo coach_setup_saved on arrival).
  if (key === 'setup' && s.arrivedAt && saved === s.arrivedAt && phasePercent(key, s) < 100) return { kind: 'saved_on_arrival', at: saved };
  return { kind: 'saved', at: saved, locked: isPhaseLocked(key, s) };
}

/** Start En Route unlocks once Pre-Departure and Load are both saved. */
export const canStartEnRoute = (s: CoachState) => isPhaseSaved('pre_departure', s) && isPhaseSaved('load', s);

/** "Completed": the coach has arrived and every phase is saved, at any %. */
export const isCoachComplete = (s: CoachState) => !!s.arrivedAt && COACH_PHASE_KEYS.every((k) => isPhaseSaved(k, s));

export class CoachRuleError extends Error {}

/**
 * Saving a phase: it must be open and not locked; saved ticks stay ticked (new ones are added);
 * any item outside this phase is ignored. Returns the new state.
 */
export function savePhase(key: CoachPhaseKey, s: CoachState, ticked: readonly string[], now: string): CoachState {
  const p = coachPhase(key);
  if (!isPhaseOpen(key, s)) {
    const st = phaseStatus(key, s);
    throw new CoachRuleError(st.kind === 'after_arrival' ? `${p.title} opens after "I have arrived".` : `${p.title} is locked until phase ${st.kind === 'locked_until' ? st.phase : p.n - 1} is saved.`);
  }
  if (isPhaseLocked(key, s)) throw new CoachRuleError(`${p.title} is saved at 100% and locked.`);
  const own = new Set(phaseItems(p).map((i) => i.key));
  const ticks = { ...s.ticks };
  for (const k of ticked) if (own.has(k) && !ticks[k]) ticks[k] = now;
  const next = { ...s, ticks, saved: { ...s.saved, [key]: now } };
  return phasePercent(key, next) >= 100 ? { ...next, locked: { ...s.locked, [key]: now } } : next;
}

/** Coach rating out of 5: the average order rating ÷ 20 (Odoo: over Booked and Done orders, any progress). */
export function coachRating(orderRatings: readonly number[]) {
  if (!orderRatings.length) return { percent: 0, stars: 0, orders: 0 };
  const avg = orderRatings.reduce((a, b) => a + b, 0) / orderRatings.length;
  return { percent: Math.round(avg * 10) / 10, stars: Math.round((avg / 20) * 10) / 10, orders: orderRatings.length };
}

/** Minutes between the scheduled start and EVENT START, and a label ("3 min late", "On time"). */
export function startVariance(scheduled: Date, actual: Date) {
  const minutes = Math.round((actual.getTime() - scheduled.getTime()) / 60000);
  const label = minutes === 0 ? 'On time' : minutes > 0 ? `${minutes} min late` : `${-minutes} min early`;
  return { minutes, label };
}

// --- GPS ---------------------------------------------------------------------------------------

export type LatLng = { lat: number; lng: number };

export function validLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/** Straight-line distance in metres (haversine). */
export function haversineMeters(a: LatLng, b: LatLng) {
  const r = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dPhi = rad(b.lat - a.lat);
  const dLambda = rad(b.lng - a.lng);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLambda / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
}

/**
 * A phone fix to ignore (Odoo _coach_gps_is_outlier): accuracy worse than 500 m, or a jump faster
 * than ~160 km/h since the last fix (plus slack for coarse city GPS).
 */
export function isGpsOutlier(prev: (LatLng & { at: Date }) | null, next: LatLng, now: Date, accuracyM?: number | null) {
  if (accuracyM != null && accuracyM > 500) return true;
  if (!prev) return false;
  const dist = haversineMeters(prev, next);
  const elapsed = Math.max((now.getTime() - prev.at.getTime()) / 1000, 1);
  return dist > 45 * elapsed + 100 + Math.min(accuracyM ?? 0, 250);
}

/** A bad map snap while close: ETA jumps 10+ minutes although the van moved 25% further away (Odoo eta spike). */
export function isEtaSpike(prevEta: number | null, eta: number, prevDistM: number | null, distM: number | null) {
  if (!prevEta || prevEta > 20 || eta < prevEta + 10) return false;
  return !!prevDistM && !!distM && distM > prevDistM * 1.25;
}

/** Text 2 goes once the ETA is 5 minutes or less. */
export const ARRIVING_SOON_MINUTES = 5;
/** Phones send a fix this often while tracking. */
export const GPS_PING_SECONDS = 25;
/** A server-side ETA check ignores fixes older than this. */
export const GPS_STALE_MINUTES = 15;
/** GPS pings are deleted after this many days. */
export const GPS_KEEP_DAYS = 90;
