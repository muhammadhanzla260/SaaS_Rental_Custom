'use client';

import { usePathname } from 'next/navigation';
import { PageBody, Topbar } from '@/components/shell/app-shell';

const SECTIONS: Record<string, string> = { orders: 'Orders', calendar: 'Calendar', customers: 'Customers', catalog: 'Products' };

export function LegacyFrame({ slug, orgName, children }: { slug: string; orgName: string; children: React.ReactNode }) {
  const parts = usePathname().split('/').filter(Boolean).slice(1);
  const section = parts[0] ?? '';
  const crumbs: { label: string; href?: string }[] = [{ label: orgName, href: `/${slug}` }, { label: SECTIONS[section] ?? section, href: `/${slug}/${section}` }];
  if (parts[1]) crumbs.push({ label: parts[1] === 'new' ? 'New' : 'Details' });
  return (
    <>
      <Topbar crumbs={crumbs} />
      <PageBody wide>{children}</PageBody>
    </>
  );
}
