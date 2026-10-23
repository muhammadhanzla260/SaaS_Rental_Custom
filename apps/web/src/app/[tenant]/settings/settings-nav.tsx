'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Building2, History, MapPinned, Palette, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { cx } from '@/components/ui';

export const SETTINGS_TABS = [
  { href: 'general', label: 'Business profile', icon: Building2 },
  { href: 'branding', label: 'Branding', icon: Palette },
  { href: 'locations', label: 'Locations', icon: MapPinned },
  { href: 'team', label: 'Team', icon: Users },
  { href: 'activity', label: 'Activity log', short: 'Activity', icon: History },
] as const;

export function SettingsNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  // On phones the tabs scroll sideways: keep the current one in view.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  return (
    <nav ref={ref} aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 border-b border-line lg:flex-col lg:border-0">
        {SETTINGS_TABS.map((t) => {
          const href = `/${slug}/settings/${t.href}`;
          const active = pathname.startsWith(href);
          return (
            <li key={t.href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex min-h-10 items-center gap-2.5 whitespace-nowrap px-3 text-[15px] transition-colors lg:rounded-ui-sm',
                  active ? 'font-semibold text-brand-text' : 'text-muted hover:text-ink',
                )}
              >
                {active && (
                  <motion.span layoutId="settings-tab" transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-brand lg:inset-0 lg:h-auto lg:rounded-ui-sm lg:bg-brand-soft" />
                )}
                <t.icon aria-hidden className="relative hidden size-4 shrink-0 lg:block" />
                <span className="relative lg:hidden">{'short' in t ? t.short : t.label}</span>
                <span className="relative hidden lg:inline">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
