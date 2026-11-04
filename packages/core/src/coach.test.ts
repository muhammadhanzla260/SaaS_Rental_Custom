import { describe, expect, it } from 'vitest';
import {
  canStartEnRoute, COACH_PHASES, CoachRuleError, coachRating, emptyCoachState, isCoachComplete, isEtaSpike, isGpsOutlier,
  isPhaseLocked, isPhaseOpen, orderRating, phaseItems, phasePercent, phaseStatus, savePhase, startVariance, validLatLng, type CoachState,
} from './coach';

const T1 = '2026-11-07T15:00:00.000Z';
const T2 = '2026-11-07T15:10:00.000Z';
const T3 = '2026-11-07T15:20:00.000Z';
const all = (n: number) => phaseItems(COACH_PHASES[n - 1]!).map((i) => i.key);

/** Pre-Departure and Load saved in full (with the load photo), ready to go. */
function loaded(): CoachState {
  let s = savePhase('pre_departure', emptyCoachState(), all(1), T1);
  s = { ...s, photos: { load: 1 } };
  return savePhase('load', s, all(2), T1);
}

describe('coach checklist: wording', () => {
  it('has the guide’s five phases and item counts', () => {
    expect(COACH_PHASES.map((p) => [p.n, p.title, phaseItems(p).length, p.photo?.label ?? null])).toEqual([
      [1, 'Pre-Departure Readiness Checks', 7, null],
      [2, 'Load Checklist', 2, 'Photo of loaded equipment'],
      [3, 'Arrival Checks', 6, null],
      [4, 'Setup & Event Start', 1, 'Setup ready photo'],
      [5, 'On-Site Close-Out', 6, 'Close-out photo proof'],
    ]);
    expect(COACH_PHASES.map((p) => p.button)).toEqual(['Save Pre-Departure', 'Save Load Checklist', 'Save Arrival Checks', 'Save Setup Checklist', 'Save Close-Out']);
  });
});

describe('phase %', () => {
  it('Load with both ticks and no photo is 2/3 = 67%; the photo makes it 100%', () => {
    const s = savePhase('load', savePhase('pre_departure', emptyCoachState(), [], T1), all(2), T1);
    expect(phasePercent('load', s)).toBe(66.7);
    expect(phasePercent('load', { ...s, photos: { load: 2 } })).toBe(100);
  });

  it('order rating is the average of the five phases', () => {
    const s = loaded(); // 100, 100, 0, 0, 0
    expect(orderRating(s)).toBe(40);
  });
});

describe('gating (enforced on save)', () => {
  it('only Phase 1 is open at first', () => {
    const s = emptyCoachState();
    expect(['pre_departure', 'load', 'arrival', 'setup', 'closeout'].map((k) => isPhaseOpen(k as never, s))).toEqual([true, false, false, false, false]);
    expect(phaseStatus('load', s)).toEqual({ kind: 'locked_until', phase: 1 });
    expect(() => savePhase('load', s, all(2), T1)).toThrow(CoachRuleError);
  });

  it('Phase 2 opens once Phase 1 is saved, even partly', () => {
    const s = savePhase('pre_departure', emptyCoachState(), ['vehicle_fueled'], T1);
    expect(isPhaseOpen('load', s)).toBe(true);
  });

  it('Phase 3 waits for "I have arrived"', () => {
    const s = loaded();
    expect(phaseStatus('arrival', s)).toEqual({ kind: 'after_arrival' });
    expect(() => savePhase('arrival', s, all(3), T2)).toThrow('opens after "I have arrived"');
    const arrived = { ...s, arrivedAt: T2, saved: { ...s.saved, setup: T2 } };
    expect(isPhaseOpen('arrival', arrived)).toBe(true);
    // Setup is auto-saved on arrival but still waits for Arrival Checks.
    expect(isPhaseOpen('setup', arrived)).toBe(false);
    expect(isPhaseOpen('closeout', arrived)).toBe(false);
  });

  it('Phase 4 opens after Phase 3 is saved; Phase 5 after Phase 4', () => {
    let s: CoachState = { ...loaded(), arrivedAt: T2, saved: { ...loaded().saved, setup: T2 } };
    s = savePhase('arrival', s, all(3), T2);
    expect(isPhaseOpen('setup', s)).toBe(true);
    expect(phaseStatus('setup', s)).toEqual({ kind: 'saved_on_arrival', at: T2 });
    expect(isPhaseOpen('closeout', s)).toBe(true);
  });

  it('Start En Route needs Pre-Departure and Load saved', () => {
    expect(canStartEnRoute(savePhase('pre_departure', emptyCoachState(), [], T1))).toBe(false);
    expect(canStartEnRoute(loaded())).toBe(true);
  });
});

describe('saving', () => {
  it('saved ticks are final; unticked ones can be ticked later', () => {
    let s = savePhase('pre_departure', emptyCoachState(), ['vehicle_fueled', 'route_planned'], T1);
    s = savePhase('pre_departure', s, ['uniform_clean'], T2); // vehicle_fueled and route_planned not sent again
    expect(Object.keys(s.ticks).sort()).toEqual(['route_planned', 'uniform_clean', 'vehicle_fueled']);
    expect(s.ticks.vehicle_fueled).toBe(T1);
    expect(s.saved.pre_departure).toBe(T2);
  });

  it('ignores items from other phases', () => {
    const s = savePhase('pre_departure', emptyCoachState(), ['vehicle_fueled', 'equipment_loaded', 'nope'], T1);
    expect(Object.keys(s.ticks)).toEqual(['vehicle_fueled']);
  });

  it('reaching 100% (adding the photo) only locks on the next Save', () => {
    const s = savePhase('load', savePhase('pre_departure', emptyCoachState(), [], T1), all(2), T1);
    const withPhoto = { ...s, photos: { load: 1 } };
    expect(phasePercent('load', withPhoto)).toBe(100);
    expect(isPhaseLocked('load', withPhoto)).toBe(false);
    expect(isPhaseLocked('load', savePhase('load', withPhoto, [], T2))).toBe(true);
  });

  it('locks at 100% once saved, until an admin reopens it', () => {
    const s = savePhase('pre_departure', emptyCoachState(), all(1), T1);
    expect(isPhaseLocked('pre_departure', s)).toBe(true);
    expect(phaseStatus('pre_departure', s)).toEqual({ kind: 'saved', at: T1, locked: true });
    expect(() => savePhase('pre_departure', s, [], T2)).toThrow('locked');
    const reopened = { ...s, reopened: { pre_departure: T2 } };
    expect(phaseStatus('pre_departure', reopened)).toEqual({ kind: 'reopened', at: T2 });
    expect(savePhase('pre_departure', reopened, [], T3).saved.pre_departure).toBe(T3);
  });
});

describe('completed and rating', () => {
  it('Completed = arrived and all five phases saved, at any %', () => {
    let s: CoachState = { ...loaded(), arrivedAt: T2, saved: { ...loaded().saved, setup: T2 } };
    s = savePhase('arrival', s, [], T2);
    expect(isCoachComplete(s)).toBe(false);
    s = savePhase('closeout', s, ['closeout_breakdown'], T3);
    expect(isCoachComplete(s)).toBe(true);
    expect(isCoachComplete({ ...s, arrivedAt: null })).toBe(false);
  });

  it('coach rating = average order % ÷ 20', () => {
    expect(coachRating([100, 80])).toEqual({ percent: 90, stars: 4.5, orders: 2 });
    expect(coachRating([])).toEqual({ percent: 0, stars: 0, orders: 0 });
  });

  it('start variance', () => {
    const at = new Date('2026-11-07T18:00:00Z');
    expect(startVariance(at, new Date('2026-11-07T18:03:00Z'))).toEqual({ minutes: 3, label: '3 min late' });
    expect(startVariance(at, new Date('2026-11-07T17:55:00Z'))).toEqual({ minutes: -5, label: '5 min early' });
    expect(startVariance(at, at).label).toBe('On time');
  });
});

describe('GPS', () => {
  const now = new Date('2026-11-07T15:00:25Z');
  const prev = { lat: 30.5, lng: -97.8, at: new Date('2026-11-07T15:00:00Z') };

  it('rejects coarse fixes and teleport jumps, keeps normal driving', () => {
    expect(isGpsOutlier(prev, { lat: 30.501, lng: -97.8 }, now, 600)).toBe(true);
    expect(isGpsOutlier(prev, { lat: 30.502, lng: -97.8 }, now, 30)).toBe(false); // ~220 m in 25 s
    expect(isGpsOutlier(prev, { lat: 30.6, lng: -97.8 }, now, 30)).toBe(true); // ~11 km in 25 s
    expect(isGpsOutlier(null, { lat: 30.6, lng: -97.8 }, now, 30)).toBe(false);
  });

  it('ignores an ETA spike that came with a jump away', () => {
    expect(isEtaSpike(8, 19, 3000, 4000)).toBe(true);
    expect(isEtaSpike(8, 19, 3000, 3100)).toBe(false);
    expect(isEtaSpike(30, 45, 3000, 9000)).toBe(false);
  });

  it('validates coordinates', () => {
    expect(validLatLng('30.5', '-97.8')).toEqual({ lat: 30.5, lng: -97.8 });
    expect(validLatLng('', '-97.8')).toBeNull();
    expect(validLatLng(91, 0)).toBeNull();
    expect(validLatLng('x', 1)).toBeNull();
  });
});
