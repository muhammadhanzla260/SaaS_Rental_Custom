import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@rental/core';
import { listUserTenants } from '@rental/db';
import { ThemeToggle } from '@/components/theme';
import { fileUrl } from '@/lib/urls';
import { requireUser } from '@/server/context';
import { db } from '@/server/db';

export const metadata = { title: 'Your organizations' };

export default async function OrgsPage() {
  const user = await requireUser('/orgs');
  const orgs = await listUserTenants(db, user.id);
  if (!orgs.length) redirect('/onboarding');
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-[max(1rem,env(safe-area-inset-left))] py-10">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-bold">Rental Custom</span>
        <ThemeToggle />
      </div>
      <h1 className="mt-10 text-2xl font-semibold">Your organizations</h1>
      <p className="mt-1 text-muted">Signed in as {user.email}</p>
      <ul className="mt-6 flex flex-col gap-2">
        {orgs.map((o) => {
          const logo = fileUrl(o.tenant_id, o.logo_file_id);
          return (
            <li key={o.tenant_id}>
              <Link href={`/${o.slug}`} className="flex items-center gap-4 rounded-ui border border-line bg-surface p-4 hover:border-line-strong">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-10 rounded-ui-sm object-contain" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-ui-sm font-display font-bold text-white" style={{ background: o.brand_color }}>
                    {o.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.name}</span>
                  <span className="block text-sm text-muted">{ROLE_LABELS[o.role as Role]?.label ?? o.role}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/onboarding" className="mt-4 inline-flex items-center gap-2 self-start rounded-ui-sm px-3 py-2 font-medium text-brand-text hover:bg-surface-2">
        <Plus aria-hidden className="size-4" /> Create another organization
      </Link>
    </main>
  );
}
