'use server';

import { redirect } from 'next/navigation';
import { acceptInvitation } from '@rental/db';
import type { ActionResult } from '@/lib/result';
import { requireUser } from '../context';
import { db } from '../db';
import { run } from './run';

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const user = await requireUser(`/invite/${token}`);
  let slug = '';
  const result = await run(async () => {
    const inv = await acceptInvitation(db, token, { id: user.id, email: user.email });
    slug = inv.tenantSlug;
    return { ok: true };
  });
  if (result.ok) redirect(`/${slug}`);
  return result;
}
