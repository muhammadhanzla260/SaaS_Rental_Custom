import 'server-only';
import { notFound } from 'next/navigation';
import type { Permission } from '@rental/core';
import { getTenantContext } from './context';

/**
 * Page-level gate. Read-only support sessions may look at every settings
 * page; members without the permission get a 404 (pages are not advertised).
 */
export async function pageContext(slug: string, permission?: Permission) {
  const ctx = await getTenantContext(slug);
  if (permission && !ctx.impersonation) {
    const { can } = await import('@rental/core');
    if (!can(ctx.role, permission, ctx.membership?.permissions ?? [])) notFound();
  }
  return ctx;
}
