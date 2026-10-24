'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth-client';
import { Avatar, cx, PRODUCT_NAME } from '@/components/kit';
import { ICONS, type NavGroup, type NavItem } from './nav';

type ShellCtx = { openNav: () => void };
const ShellContext = createContext<ShellCtx>({ openNav: () => {} });
export const useShell = () => useContext(ShellContext);

export type SidebarStyle = 'dark' | 'light' | 'brand';

export type ShellProps = {
  base: string;
  groups: NavGroup[];
  header: ReactNode;
  user: { name: string; email: string; image?: string | null; sub?: string };
  sidebar?: SidebarStyle;
  /** Extra palette entries (⌘K): organizations to switch to, etc. */
  jumps?: { label: string; href: string; hint?: string }[];
  children: ReactNode;
};

function NavIcon({ d, className, color }: { d: string; className?: string; color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cx('shrink-0', className)}>
      <path d={d} />
    </svg>
  );
}

function isActive(path: string, base: string, item: NavItem) {
  if (item.href === undefined) return false;
  const full = `${base}${item.href}`;
  if (item.href === '') return path === base || path === `${base}/`;
  if (path === full) return true;
  if (item.id === 'pos') return false;
  return path.startsWith(`${full}/`) && !(item.id === 'orders' && path === `${base}/orders/new`);
}

const STYLE: Record<SidebarStyle, { panel: string; item: string; on: string; off: string; label: string; search: string; line: string; dot: string }> = {
  dark: {
    panel: 'bg-night text-[#EEF0F4]', item: 'text-[#A3ABB9] hover:bg-white/6 hover:text-white', on: 'bg-white/8 text-white',
    off: 'text-[#7D8594]', label: 'text-[#7D8594]', search: 'border-[#1C212B] bg-white/4 text-[#A3ABB9] hover:bg-white/7', line: 'border-[#1C212B]', dot: 'bg-volt',
  },
  light: {
    panel: 'bg-surface text-fg border-r border-subtle', item: 'text-fg-2 hover:bg-sunken hover:text-fg', on: 'bg-accent-soft text-accent-text',
    off: 'text-fg-3', label: 'text-fg-2', search: 'border-subtle bg-sunken text-fg-2 hover:bg-hover', line: 'border-subtle', dot: 'bg-accent',
  },
  brand: {
    panel: 'bg-accent text-on-accent', item: 'text-on-accent/75 hover:bg-black/10 hover:text-on-accent', on: 'bg-black/15 text-on-accent',
    off: 'text-on-accent/50', label: 'text-on-accent/60', search: 'border-black/10 bg-black/10 text-on-accent/80 hover:bg-black/15', line: 'border-black/10', dot: 'bg-on-accent',
  },
};

function Sidebar({ base, groups, header, user, sidebar = 'dark', onSearch, onNavigate }: ShellProps & { onSearch: () => void; onNavigate?: () => void }) {
  const path = usePathname();
  const router = useRouter();
  const s = STYLE[sidebar];
  let n = 0;
  const signOut = async () => {
    await authClient.signOut();
    router.push('/sign-in');
    router.refresh();
  };
  return (
    <nav aria-label="Main" className={cx('flex h-full flex-col gap-4 overflow-y-auto overscroll-contain px-3.5 pb-3 pt-[max(1.1rem,env(safe-area-inset-top))]', s.panel)}>
      <div className="flex items-center gap-2.5 px-1.5">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-volt" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0B0D12" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 3 20h18L12 3Z" /><path d="M12 3v17" /></svg>
        </span>
        <span className="font-display text-lg font-bold tracking-[-0.01em]">{PRODUCT_NAME}</span>
      </div>

      {header}

      <button type="button" onClick={onSearch} className={cx('flex h-[38px] shrink-0 items-center gap-2.5 rounded-[10px] border px-2.5 text-[13px] transition-colors', s.search)}>
        <Search className="size-[15px]" aria-hidden="true" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="mono rounded-md border border-current/25 px-1.5 py-0.5 text-[11px] opacity-80">⌘K</kbd>
      </button>

      <div className="flex flex-1 flex-col gap-4">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <span className={cx('px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]', s.label)}>{g.label}</span>
            {g.items.map((it) => {
              n += 1;
              const delay = { ['--d' as string]: `${n * 25}ms` };
              if (it.href === undefined) {
                return (
                  <div key={it.id} className={cx('anim-rise flex h-[38px] items-center gap-3 rounded-[10px] px-2.5 text-sm font-medium', s.off)} style={delay} aria-disabled="true" title={`Arrives in Phase ${it.phase}`}>
                    <NavIcon d={ICONS[it.icon]} className="opacity-60" />
                    <span className="flex-1 truncate">{it.label}</span>
                    <span className="mono rounded-md border border-current/30 px-1.5 py-[3px] text-[10px] font-semibold leading-none">P{it.phase}</span>
                  </div>
                );
              }
              const on = isActive(path, base, it);
              return (
                <Link
                  key={it.id}
                  href={`${base}${it.href}`}
                  onClick={onNavigate}
                  aria-current={on ? 'page' : undefined}
                  className={cx('anim-rise flex h-[38px] items-center gap-3 rounded-[10px] px-2.5 text-sm font-medium transition-[background-color,color,transform] duration-200 hover:translate-x-0.5', on ? s.on : s.item)}
                  style={delay}
                >
                  <NavIcon d={ICONS[it.icon]} color={on && sidebar === 'dark' ? '#D4FF3A' : undefined} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {on && <span className={cx('anim-glow size-1.5 rounded-full', s.dot)} aria-hidden="true" />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className={cx('flex items-center gap-2.5 border-t px-1.5 pt-3', s.line)}>
        <Avatar name={user.name} src={user.image} size={32} color="#2C4FE0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{user.name}</span>
          <span className={cx('truncate text-xs', s.label)}>{user.sub ?? user.email}</span>
        </span>
        <AppearanceButton className={s.item} />
        <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className={cx('grid size-8 place-items-center rounded-lg transition-colors', s.item)}>
          <LogOut className="size-4" />
        </button>
      </div>
    </nav>
  );
}

/** Personal light/dark switch (overrides the org default, stored on this device). */
function AppearanceButton({ className }: { className: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const flip = () => {
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme-override', next); } catch {}
    document.documentElement.setAttribute('data-theme', next);
    setDark(!dark);
  };
  return (
    <button type="button" onClick={flip} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title="Appearance" className={cx('grid size-8 place-items-center rounded-lg transition-colors', className)}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** ⌘K: jump to any page or organization. */
function CommandPalette({ open, onClose, base, groups, jumps }: { open: boolean; onClose: () => void; base: string; groups: NavGroup[]; jumps?: ShellProps['jumps'] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const pages = groups.flatMap((g) => g.items.filter((it) => it.href !== undefined).map((it) => ({ label: it.label, href: `${base}${it.href}`, hint: g.label })));
    const all = [...pages, ...(jumps ?? [])];
    const t = q.trim().toLowerCase();
    return t ? all.filter((x) => x.label.toLowerCase().includes(t) || x.hint?.toLowerCase().includes(t)) : all;
  }, [q, groups, base, jumps]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setQ(''); setI(0); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setI(0), [q]);
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <dialog
      ref={ref}
      aria-label="Search or jump to"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="mx-auto mt-[12vh] w-[calc(100%-32px)] max-w-lg bg-transparent p-0 backdrop:bg-[var(--scrim)]"
    >
      {open && (
        <div className="anim-modal overflow-hidden rounded-[var(--radius-panel)] border border-subtle bg-surface shadow-[var(--shadow-float)]">
          <div className="flex items-center gap-2 border-b border-subtle px-4">
            <Search className="size-4 text-fg-2" aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
                if (e.key === 'Enter' && items[i]) go(items[i].href);
              }}
              placeholder="Search pages and organizations…"
              aria-label="Search"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmdk-list"
              aria-activedescendant={items[i] ? `cmdk-${i}` : undefined}
              className="h-12 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-3 focus:outline-none"
            />
            <kbd className="mono rounded-md border border-subtle px-1.5 py-0.5 text-[11px] text-fg-2">Esc</kbd>
          </div>
          <ul id="cmdk-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-2">Nothing matches “{q}”.</li>}
            {items.map((x, idx) => (
              <li key={x.href + x.label} id={`cmdk-${idx}`} role="option" aria-selected={idx === i}>
                <button
                  type="button"
                  onMouseEnter={() => setI(idx)}
                  onClick={() => go(x.href)}
                  className={cx('flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm', idx === i ? 'bg-accent-soft text-fg' : 'text-fg')}
                >
                  <span className="font-medium">{x.label}</span>
                  {x.hint && <span className="text-xs text-fg-2">{x.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}

export function AppShell(props: ShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setNavOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    document.documentElement.style.overflow = navOpen ? 'hidden' : '';
  }, [navOpen]);
  const openNav = useCallback(() => setNavOpen(true), []);
  const openSearch = () => { setNavOpen(false); setCmdOpen(true); };

  return (
    <ShellContext.Provider value={{ openNav }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
        <aside className="sticky top-0 hidden h-dvh lg:block">
          <Sidebar {...props} onSearch={openSearch} />
        </aside>
        {navOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" className="anim-fade absolute inset-0 bg-[var(--scrim)]" aria-label="Close menu" onClick={() => setNavOpen(false)} />
            <div className="anim-slide-left absolute inset-y-0 left-0 w-[min(288px,86vw)] shadow-[var(--shadow-float)]">
              <Sidebar {...props} onSearch={openSearch} onNavigate={() => setNavOpen(false)} />
              <button type="button" onClick={() => setNavOpen(false)} aria-label="Close menu" className="absolute right-3 top-[max(1rem,env(safe-area-inset-top))] grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <div className="min-w-0">{props.children}</div>
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} base={props.base} groups={props.groups} jumps={props.jumps} />
    </ShellContext.Provider>
  );
}

/** Sticky top bar with breadcrumb; holds the menu button on phones and tablets. */
export function Topbar({ crumbs, actions }: { crumbs: { label: string; href?: string }[]; actions?: ReactNode }) {
  const { openNav } = useShell();
  return (
    <header className="sticky top-0 z-30 border-b border-subtle bg-surface/90 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-[var(--gutter)] pt-[env(safe-area-inset-top)] sm:h-16">
        <button type="button" onClick={openNav} aria-label="Open menu" className="-ml-1.5 grid size-10 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg lg:hidden">
          <Menu className="size-5" />
        </button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-2 text-sm sm:text-[15px]">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={i} className={cx('flex min-w-0 items-center gap-2', !last && 'max-sm:hidden')}>
                  {c.href && !last ? (
                    <Link href={c.href} className="truncate text-fg-2 hover:text-fg">{c.label}</Link>
                  ) : (
                    <span className={cx('truncate', last ? 'font-semibold text-fg' : 'text-fg-2')} aria-current={last ? 'page' : undefined}>{c.label}</span>
                  )}
                  {!last && <span className="text-fg-3" aria-hidden="true">/</span>}
                </li>
              );
            })}
          </ol>
        </nav>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <main id="main" className={cx('mx-auto w-full px-[var(--gutter)] pb-16 pt-6 sm:pt-10', wide ? 'max-w-[1600px]' : 'max-w-[1240px]', className)}>
      {children}
    </main>
  );
}
