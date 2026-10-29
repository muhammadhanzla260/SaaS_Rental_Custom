import { getTenantContext } from '@/server/context';
import { LegacyFrame } from './legacy-frame';

/**
 * Phase 1 screens (orders, calendar, customers, catalog) are rebuilt in the
 * Phase 1 revamp. Until then they sit in the new shell with the new top bar.
 */
export default async function Phase1Layout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await getTenantContext(slug);
  return <LegacyFrame slug={slug} orgName={tenant.name}>{children}</LegacyFrame>;
}
