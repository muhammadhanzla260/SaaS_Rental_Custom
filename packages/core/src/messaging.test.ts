import { describe, expect, it } from 'vitest';
import {
  checkTemplateSource, DEFAULT_SCHEDULES, defaultTemplate, fieldsIn, fillFields, messagingSettingsSchema, outsideQuietHours, renderMessage,
  resolveMessaging, sanitizeEmailHtml, SAMPLE_FIELDS, scheduledAt, smsSegments,
} from './messaging';

const TZ = 'America/Chicago';
const event = { startsAt: new Date('2026-11-07T19:00:00Z'), endsAt: new Date('2026-11-08T00:00:00Z') }; // Sat 1-6 PM CST

describe('schedules (Odoo timings, location time zone)', () => {
  it('pre-event 3 days before start at 09:00 local', () => {
    expect(scheduledAt(DEFAULT_SCHEDULES.pre_event, event, TZ).toISOString()).toBe('2026-11-04T15:00:00.000Z');
  });
  it('charge balance on the event day at 08:00 local', () => {
    expect(scheduledAt(DEFAULT_SCHEDULES.charge_balance, event, TZ).toISOString()).toBe('2026-11-07T14:00:00.000Z');
  });
  it('review 1 day after the end (the end is Saturday evening local, not Sunday UTC)', () => {
    expect(scheduledAt(DEFAULT_SCHEDULES.review_request, event, TZ).toISOString()).toBe('2026-11-08T16:00:00.000Z');
  });
  it('crosses daylight saving correctly (Oct 31 is still CDT)', () => {
    expect(scheduledAt(DEFAULT_SCHEDULES.day_before, { startsAt: new Date('2026-11-01T18:00:00Z'), endsAt: new Date('2026-11-01T22:00:00Z') }, TZ).toISOString())
      .toBe('2026-10-31T14:00:00.000Z');
  });
  it('acceptance 3: moving the day-before reminder to 2 days at 18:00 moves the send time', () => {
    const rule = { ...DEFAULT_SCHEDULES.day_before, days: 2, time: '18:00' };
    expect(scheduledAt(rule, event, TZ).toISOString()).toBe('2026-11-06T00:00:00.000Z'); // Thu 6 PM CST
  });
});

describe('quiet hours', () => {
  it('acceptance 4: a text at 22:30 waits until 08:00 next morning', () => {
    expect(outsideQuietHours(new Date('2026-11-06T04:30:00Z'), TZ, '21:00', '08:00').toISOString()).toBe('2026-11-06T14:00:00.000Z');
  });
  it('early morning waits until 08:00 the same day; daytime is untouched', () => {
    expect(outsideQuietHours(new Date('2026-11-06T13:00:00Z'), TZ, '21:00', '08:00').toISOString()).toBe('2026-11-06T14:00:00.000Z');
    const noon = new Date('2026-11-06T18:00:00Z');
    expect(outsideQuietHours(noon, TZ, '21:00', '08:00')).toBe(noon);
  });
});

describe('templates', () => {
  it('fills known fields, leaves unknown ones as typed, accepts {{double}} braces', () => {
    expect(fillFields('Hi {customer.first_name}, {{order.number}} {nope.field}', SAMPLE_FIELDS)).toBe('Hi Maria, Q-AUS-01043 {nope.field}');
    expect(fieldsIn('{customer.first_name} {foo.bar}')).toEqual({ known: ['customer.first_name'], unknown: ['foo.bar'] });
  });
  it('acceptance 6: an uploaded template with <script> warns, and the sent HTML has it stripped', () => {
    const src = '<html><body><p onclick="x()">Hi {customer.first_name}</p><script>alert(1)</script><a href="javascript:alert(2)">x</a></body></html>';
    const checks = checkTemplateSource(src, 'html');
    expect(checks.find((c) => c.key === 'scripts')?.level).toBe('warn');
    const out = renderMessage({
      channel: 'email', template: { ...defaultTemplate('quote', 'email'), mode: 'raw', rawSource: src }, values: SAMPLE_FIELDS,
      brand: { orgName: 'Freedom Fun USA', brandColor: '#C2410C', onBrand: '#fff' }, links: {},
    });
    expect(out.html).not.toMatch(/<script|onclick|javascript:/i);
    expect(out.html).toContain('Hi Maria');
    expect(sanitizeEmailHtml('<iframe src="x"></iframe><b>ok</b>')).toBe('<b>ok</b>');
  });
  it('flags oversized and malformed XML', () => {
    expect(checkTemplateSource('<a><b></a>', 'xml')[0]!.level).toBe('fail');
    expect(checkTemplateSource(`<p>${'x'.repeat(110_000)}</p>`, 'html').find((c) => c.key === 'size')?.level).toBe('warn');
  });
  it('builder email carries the branded button and a plain-text version', () => {
    const out = renderMessage({
      channel: 'email', template: defaultTemplate('quote', 'email'), values: SAMPLE_FIELDS,
      brand: { orgName: 'Freedom Fun USA', brandColor: '#C2410C', onBrand: '#fff' }, summary: [{ label: 'Deposit to book', value: '$185.43' }],
      links: { pay_link: 'https://app.test/q/abc' },
    });
    expect(out.subject).toBe('Your quote Q-AUS-01043 is ready, Maria');
    expect(out.html).toContain('href="https://app.test/q/abc"');
    expect(out.text).toContain('Review, sign & pay: https://app.test/q/abc');
  });
});

describe('SMS segments and settings', () => {
  it('counts GSM-7 and Unicode segments', () => {
    expect(smsSegments('x'.repeat(160))).toMatchObject({ segments: 1, encoding: 'GSM-7' });
    expect(smsSegments('x'.repeat(161)).segments).toBe(2);
    expect(smsSegments('Party time 🎉').encoding).toBe('Unicode');
  });
  it('a new workspace starts with automations off and the Odoo defaults filled in', () => {
    const r = resolveMessaging(messagingSettingsSchema.parse({}));
    expect(r.live).toBe(false);
    expect(r.schedules.pre_event).toMatchObject({ days: 3, direction: 'before', time: '09:00' });
    expect(r.schedules.survey_reminder!.enabled).toBe(false);
    expect(r.instant.quote).toBe(true);
  });
});
