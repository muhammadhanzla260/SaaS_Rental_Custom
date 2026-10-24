import Link from 'next/link';
import { ChevronsUpDown } from 'lucide-react';
import { cx } from '@/components/kit';
import { LogoMark } from '@/components/brand/logo-mark';
import type { LogoAdjust } from '@rental/core';

/** Tenant card at the top of the sidebar ("Freedom Fun USA · Owner · 4 locations"). */
export function TenantCard({
  name, sub, brandColor, logoUrl, logoAdjust, switchHref, sidebar = 'dark',
}: { name: string; sub: string; brandColor: string; logoUrl: string | null; logoAdjust: LogoAdjust; switchHref?: string; sidebar?: 'dark' | 'light' | 'brand' }) {
  const body = (
    <>
      <LogoMark name={name} url={logoUrl} adjust={logoAdjust} size={32} brandColor={brandColor} fallbackColor={sidebar === 'dark' ? '#D4FF3A' : brandColor} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className={cx('truncate text-xs', sidebar === 'light' ? 'text-fg-2' : 'opacity-70')}>{sub}</span>
      </span>
      {switchHref && <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />}
    </>
  );
  const cls = cx(
    'flex shrink-0 items-center gap-2.5 rounded-xl border p-2.5 transition-colors',
    sidebar === 'dark' ? 'border-night-line bg-white/3 hover:border-[#3A4152] hover:bg-white/6' : sidebar === 'light' ? 'border-subtle bg-canvas hover:bg-sunken' : 'border-black/10 bg-black/10 hover:bg-black/15',
  );
  return switchHref ? (
    <Link href={switchHref} className={cls} aria-label={`${name}: switch organization`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
