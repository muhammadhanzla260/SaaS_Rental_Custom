import { getCustomer, listCustomers, type CustomerFilter } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { CustomersView } from './customers-view';

export const metadata = { title: 'Customers' };

const FILTERS: CustomerFilter[] = ['all', 'people', 'organizations', 'repeat'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomersPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ q?: string; f?: string; id?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const filter = (FILTERS as string[]).includes(sp.f ?? '') ? (sp.f as CustomerFilter) : 'all';
  const q = (sp.q ?? '').slice(0, 80);
  const [list, profile] = await Promise.all([
    listCustomers(db, ctx.tenant.id, { search: q, filter, limit: 200 }),
    sp.id && UUID.test(sp.id) ? getCustomer(db, ctx.tenant.id, sp.id) : Promise.resolve(null),
  ]);
  return (
    <CustomersView
      slug={slug}
      rows={list.rows.map((r) => ({
        id: r.id, name: r.displayName ?? 'Unnamed', kind: r.kind, email: r.email, phone: r.phone, country: r.country, tags: r.tags, taxExempt: r.taxExempt,
        repeat: r.repeat, orderCount: r.orderCount, lifetimeCents: r.lifetimeCents, balanceCents: r.balanceCents, lastEventAt: r.lastEventAt, lastStatus: r.lastStatus,
      }))}
      counts={list.counts}
      filter={filter}
      q={q}
      profile={profile}
      currency={ctx.tenant.currency}
      country={ctx.tenant.country}
      perms={{ canEdit: ctx.can('customers.manage'), canCredit: ctx.can('payments.refund'), canOrder: ctx.can('orders.create') }}
    />
  );
}
