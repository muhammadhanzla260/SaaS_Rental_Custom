import { formatMoney, type TenantPreferences } from '@rental/core';
import type { Order } from '@rental/db';

export type SummaryRow = { label: string; value: string; tone?: 'credit' };

/** An order's price breakdown, as the customer sees it (quote page, invoices, receipts). */
export function orderSummaryRows(o: Order, currency: string): SummaryRow[] {
  const money = (c: number) => formatMoney(c, currency);
  const s = (o.summary ?? {}) as Record<string, number>;
  const travel = (o.travelInfo ?? {}) as { billable?: number };
  return [
    { label: 'Rental items', value: money(o.merchandiseCents) },
    ...(s.customCents ? [{ label: 'Other items', value: money(s.customCents) }] : []),
    ...(o.damageWaiver ? [{ label: `Damage waiver ${Number(o.damageWaiverPercent)}%`, value: money(s.damageWaiverCents ?? 0) }] : []),
    ...(s.setupSurfaceCents ? [{ label: 'Setup surface', value: money(s.setupSurfaceCents) }] : []),
    ...(s.eventLocationCents ? [{ label: 'Event location fee', value: money(s.eventLocationCents) }] : []),
    ...(o.travelFeeCents ? [{ label: `Travel${travel.billable ? ` · ${Number(travel.billable).toFixed(1)} billable mi` : ''}`, value: money(o.travelFeeCents) }] : []),
    ...(s.preTaxDiscountCents ? [{ label: 'Discount', value: `−${money(s.preTaxDiscountCents)}`, tone: 'credit' as const }] : []),
    ...(s.couponCents ? [{ label: `Coupon ${o.couponCode ?? ''}`.trim(), value: `−${money(s.couponCents)}`, tone: 'credit' as const }] : []),
    { label: `Sales tax ${Number(o.taxPercent)}%`, value: money(o.taxCents) },
    ...(o.creditCents ? [{ label: 'Rain checks & credits', value: `−${money(o.creditCents)}`, tone: 'credit' as const }] : []),
  ];
}

export const surfaceLabel = (prefs: TenantPreferences, code: string | null) => prefs.booking.setupSurfaces.find((x) => x.code === code)?.label ?? null;

/** "Oct 23" from a yyyy-mm-dd date (no time-zone drift). */
export const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
