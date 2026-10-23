'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, Boxes, CalendarDays, ChevronsUpDown, ClipboardList, CreditCard, FileText, LayoutDashboard, LogOut,
  Menu, Plus, Settings, Users, X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { ROLE_LABELS, type Role } from '@rental/core';
import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from './theme';
import { cx } from './ui';

type Org = { slug: string; name: string; brandColor: string };

const MAIN = [
  { href: '', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/orders', label: 'Orders', icon: ClipboardList },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/catalog', label: 'Catalog', icon: Boxes },
];
const SOON = [
  { label: 'Invoices', icon: FileText, phase: 2 },
  { label: 'Payments', icon: CreditCard, phase: 2 },
  { label: 'Reports', icon: BarChart3, phase: 3 },
];

function Logo({ name, logoUrl, logoDarkUrl }: { name: string; logoUrl: string | null; logoDarkUrl: string | null }) {
  if (!logoUrl) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-ui-sm font-display text-sm font-bold text-brand-fg shadow-[0_6px_14px_-8px_var(--brand)]">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate font-display text-[15px] font-bold">{name}</span>
      </span>
    );
  }
  /* eslint-disable @next/next/no-img-element */
  return (
    <span className="flex min-w-0 items-center">
      <img
        src={logoUrl}
        alt={name}
        className={cx(
          'h-9 max-w-[170px] object-contain object-left',
          // No dark-background logo yet: keep the regular one readable on a light badge.
          logoDarkUrl ? 'dark:hidden' : 'dark:rounded-ui-sm dark:bg-white dark:px-2 dark:py-1',
        )}
      />
      {logoDarkUrl && <img src={logoDarkUrl} alt={name} className="hidden h-9 max-w-[170px] object-contain object-left dark:block" />}
    </span>
  );
}

function NavLink({ href, label, icon: Icon, active, layoutGroup }: { href: string; label: string; icon: typeof Settings; active: boolean; layoutGroup: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx('relative flex min-h-10 items-center gap-3 rounded-ui-sm px-3 text-[15px] transition-colors', active ? 'font-semibold text-brand-text' : 'text-ink/75 hover:text-ink')}
    >
      {active && (
        <motion.span layoutId={`${layoutGroup}-active`} className="absolute inset-0 rounded-ui-sm bg-brand-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }}>
          <span className="brand-gradient absolute inset-y-2 left-0 w-1 rounded-full" />
        </motion.span>
      )}
      <Icon aria-hidden className="relative size-[18px] shrink-0" />
      <span className="relative">{label}</span>
    </Link>
  );
}

export function AppShell({
  slug, tenant, user, role, canManageSettings, orgs, children,
}: {
  slug: string;
  tenant: { name: string; logoUrl: string | null; logoDarkUrl: string | null };
  user: { name: string; email: string };
  role: Role;
  canManageSettings: boolean;
  orgs: Org[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  useEffect(() => { setOpen(false); setSwitcher(false); }, [pathname]);

  const base = `/${slug}`;
  const isActive = (href: string) => (href === '' ? pathname === base : pathname.startsWith(base + href));
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const signOut = async () => {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  };

  const sidebar = (inDrawer: boolean) => (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      <div className={cx('relative px-1', inDrawer && 'mr-11')}>
        <button type="button" onClick={() => setSwitcher(!switcher)} aria-expanded={switcher}
          className="flex w-full items-center justify-between gap-2 rounded-ui-sm p-1.5 text-left transition-colors hover:bg-surface-2">
          <Logo {...tenant} />
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="sr-only">Switch organization</span>
        </button>
        <AnimatePresence>
          {switcher && (
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-x-1 top-full z-30 mt-1 rounded-ui border border-line bg-surface p-1.5 shadow-pop">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">Organizations</p>
              {orgs.map((o) => (
                <Link key={o.slug} href={`/${o.slug}`} className={cx('flex items-center gap-2 rounded-ui-sm px-2 py-2 text-[15px] hover:bg-surface-2', o.slug === slug && 'font-semibold')}>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: o.brandColor }} />
                  <span className="truncate">{o.name}</span>
                </Link>
              ))}
              <Link href="/onboarding" className="mt-1 flex items-center gap-2 rounded-ui-sm border-t border-line px-2 py-2 text-[15px] text-muted hover:bg-surface-2 hover:text-ink">
                <Plus aria-hidden className="size-4" /> New organization
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Link href={`${base}/orders/new`}
        className="btn-shine brand-gradient flex min-h-11 items-center justify-center gap-2 rounded-ui-sm font-semibold text-brand-fg shadow-[0_8px_20px_-10px_var(--brand)] transition-transform active:scale-[0.98]">
        <Plus aria-hidden className="size-4" /> New order
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {MAIN.map((item) => (
          <NavLink key={item.label} href={base + item.href} label={item.label} icon={item.icon} active={isActive(item.href)} layoutGroup={inDrawer ? 'drawer' : 'side'} />
        ))}
        {canManageSettings && (
          <NavLink href={`${base}/settings`} label="Settings" icon={Settings} active={isActive('/settings')} layoutGroup={inDrawer ? 'drawer' : 'side'} />
        )}
      </nav>

      <div>
        <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Coming next</p>
        <ul className="flex flex-col">
          {SOON.map((item) => (
            <li key={item.label} title={`Arrives in Phase ${item.phase}`}
              className="flex min-h-9 items-center gap-3 rounded-ui-sm px-3 text-[14px] text-muted/80">
              <item.icon aria-hidden className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <span className="text-[10px] tabular">P{item.phase}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex min-w-0 items-center gap-3 px-2">
          <span className="brand-gradient grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-brand-fg">{initials}</span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{ROLE_LABELS[role].label} · {user.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ThemeToggle />
          <button type="button" onClick={signOut} className="inline-flex min-h-9 items-center gap-2 rounded-ui-sm px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
            <LogOut aria-hidden className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface/80 backdrop-blur lg:block">{sidebar(false)}</aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface/90 px-[max(1rem,env(safe-area-inset-left))] pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <Logo {...tenant} />
        <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-ui-sm hover:bg-surface-2" aria-label="Open menu" aria-expanded={open}>
          <Menu aria-hidden className="size-5" />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-pop">
              <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 grid size-10 place-items-center rounded-ui-sm hover:bg-surface-2" aria-label="Close menu">
                <X aria-hidden className="size-5" />
              </button>
              {sidebar(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="min-w-0 px-[max(1rem,env(safe-area-inset-left))] pb-16 pt-6 sm:px-8 lg:pt-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
