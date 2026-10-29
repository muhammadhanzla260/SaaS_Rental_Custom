import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@rental/core';
import { isPlatformAdmin, listUserTenants } from '@rental/db';
import { Avatar, Pill, Wordmark } from '@/components/kit';
import { fileUrl } from '@/lib/urls';
import { requireUser } from '@/server/context';
import { db } from '@/server/db';

export const metadata = { title: 'Your organizations' };

export default async function OrgsPage() {
  const user = await requireUser('/orgs');
  const [orgs, admin] = await Promise.all([listUserTenants(db, user.id), isPlatformAdmin(db, user.id)]);
  if (!orgs.length && !admin) redirect('/register');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col px-[var(--gutter)] py-10">
      <Wordmark dark />
      <h1 className="anim-rise mt-12 font-display text-[34px] font-extrabold tracking-[-0.02em] text-fg">Pick a workspace</h1>
      <p className="mt-1 text-fg-2">Signed in as {user.email}</p>
      <ul className="mt-7 flex flex-col gap-2.5">
        {admin && (
          <li className="anim-rise">
            <Link href="/console" className="lift flex items-center gap-4 rounded-[var(--radius-card)] border border-[#5A1D22] bg-night p-4 text-white">
              <span className="grid size-11 place-items-center rounded-xl bg-[#2A1115]"><span className="size-2.5 rounded-full bg-[#FF6B6B]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Platform console</span>
                <span className="block text-sm text-[#A3ABB9]">Super admin · every organization</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-[#A3ABB9]" />
            </Link>
          </li>
        )}
        {orgs.map((o, i) => (
          <li key={o.tenant_id} className="anim-rise" style={{ ['--d' as string]: `${(i + 1) * 50}ms` }}>
            <Link href={o.onboarded ? `/${o.slug}` : `/onboarding/${o.slug}`} className="lift flex items-center gap-4 rounded-[var(--radius-card)] border border-subtle bg-surface p-4">
              <Avatar name={o.name} src={fileUrl(o.tenant_id, o.logo_file_id)} size={44} round={false} color={o.brand_color} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-fg">{o.name}</span>
                <span className="block text-sm text-fg-2">{ROLE_LABELS[o.role as Role]?.label ?? o.role} · {o.locations} location{o.locations === 1 ? '' : 's'}</span>
              </span>
              {o.status === 'suspended' && <Pill tone="danger">Suspended</Pill>}
              {!o.onboarded && <Pill tone="info">Setup</Pill>}
              <ChevronRight aria-hidden className="size-5 text-fg-2" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/register" className="mt-5 inline-flex items-center gap-2 self-start rounded-[var(--radius-control)] px-3 py-2 font-semibold text-accent-text hover:bg-sunken">
        <Plus aria-hidden className="size-4" /> Create another workspace
      </Link>
    </main>
  );
}
