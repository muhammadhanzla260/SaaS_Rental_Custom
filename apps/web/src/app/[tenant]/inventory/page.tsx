import { inventoryOverview, listLocations, listProducts } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { InventoryView, type HeatRow, type UnitRow } from './inventory-view';

export const metadata = { title: 'Inventory' };

const DAYS = 14;

/** Today's date in a time zone, as YYYY-MM-DD. */
function localDate(tz: string, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export default async function InventoryPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ loc?: string }> }) {
  const { tenant: slug } = await params;
  const { loc } = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const locations = (await listLocations(db, ctx.tenant.id)).filter((l) => l.isActive);
  const location = locations.find((l) => l.id === loc) ?? locations.find((l) => l.isPrimary) ?? locations[0];
  if (!location) {
    return <InventoryView slug={slug} empty locations={[]} locationId="" days={[]} rows={[]} units={[]} kpis={null} canEdit={false} />;
  }
  const tz = location.timezone || ctx.tenant.timezone;
  const from = localDate(tz);
  const [overview, products] = await Promise.all([inventoryOverview(db, ctx.tenant.id, location.id, from, DAYS, tz), listProducts(db, ctx.tenant.id)]);

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const byProduct = new Map<string, Map<string, { owned: number; held: number }>>();
  for (const r of overview.daily) {
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, new Map());
    byProduct.get(r.productId)!.set(r.day, { owned: r.owned, held: r.held });
  }
  const tracked = products.filter((p) => p.status === 'active' && p.tracking !== 'none' && (p.kind === 'rental' || p.kind === 'addon'));
  const rows: HeatRow[] = tracked
    .map((p) => {
      const cells = days.map((d) => byProduct.get(p.id)?.get(d) ?? { owned: 0, held: 0 });
      const owned = p.inventory[location.id]?.owned ?? (p.tracking === 'pooled' ? 1 : 0);
      return { id: p.id, name: p.name, kind: p.kind, icon: p.icon, tint: p.tint, owned, tracking: p.tracking, cells };
    })
    .filter((r) => r.owned > 0 || r.cells.some((c) => c.held > 0));

  // Units: give each available unit the product's next booking in turn; flag holds a unit in repair now leaves short.
  const upcomingBy = new Map<string, typeof overview.upcoming>();
  for (const r of overview.upcoming) upcomingBy.set(r.productId, [...(upcomingBy.get(r.productId) ?? []), r]);
  const capacityOf = (productId: string) => overview.units.filter((u) => u.productId === productId && (u.status === 'ready' || u.status === 'cleaning')).length;
  const clashes = (productId: string) => {
    const list = upcomingBy.get(productId) ?? [];
    const cap = capacityOf(productId);
    return list.filter((r) => list.filter((o) => o.startsAt < r.blockedUntil && o.blockedUntil > r.startsAt).reduce((s, o) => s + o.quantity, 0) > cap);
  };
  const seen = new Map<string, number>();
  const units: UnitRow[] = overview.units.map((u) => {
    const held = u.status === 'maintenance' || u.status === 'out_of_service';
    let next: UnitRow['next'] = null;
    if (held) {
      const c = clashes(u.productId)[0];
      if (c) next = { at: c.startsAt.toISOString(), number: c.number, orderId: c.orderId, clash: true };
    } else {
      const i = seen.get(u.productId) ?? 0;
      seen.set(u.productId, i + 1);
      const r = upcomingBy.get(u.productId)?.[i];
      if (r) next = { at: r.startsAt.toISOString(), number: r.number, orderId: r.orderId, clash: false };
    }
    return { id: u.id, label: u.label, serial: u.serial, status: u.status, productName: u.productName, next };
  });

  // KPIs at this location.
  const ownedTotal = rows.reduce((s, r) => s + r.owned, 0);
  const weekHeld = days.slice(0, 7).map((d, i) => ({ day: d, held: rows.reduce((s, r) => s + (r.cells[i]?.held ?? 0), 0) }));
  const busiest = weekHeld.reduce((a, b) => (b.held > a.held ? b : a), weekHeld[0]!);
  const pooledHeld = products.reduce((s, p) => s + (p.tracking === 'pooled' ? (p.inventory[location.id]?.outOfService ?? 0) : 0), 0);
  const unitHeld = overview.units.filter((u) => u.status === 'maintenance' || u.status === 'out_of_service').length;
  const unitDays = rows.reduce((s, r) => s + r.cells.reduce((a, c) => a + c.owned, 0), 0);
  const heldDays = rows.reduce((s, r) => s + r.cells.reduce((a, c) => a + Math.min(c.held, c.owned), 0), 0);

  return (
    <InventoryView
      slug={slug}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      locationId={location.id}
      days={days}
      rows={rows}
      units={units}
      timezone={tz}
      canEdit={ctx.can('catalog.manage')}
      kpis={{
        owned: ownedTotal,
        products: rows.length,
        busiestDay: busiest.held > 0 ? busiest.day : null,
        busiestHeld: busiest.held,
        held: pooledHeld + unitHeld,
        utilization: unitDays ? Math.round((heldDays / unitDays) * 100) : 0,
      }}
    />
  );
}
