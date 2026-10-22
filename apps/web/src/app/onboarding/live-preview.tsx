'use client';

import { CalendarDays, ClipboardList, LayoutDashboard, MapPin, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { buildPalette, RADIUS_OPTIONS, type RadiusOption } from '@rental/core';
import { AnimatedNumber } from '@/components/motion';
import { StaticMap } from '@/components/static-map';

/**
 * A miniature of the organization's own app, rebuilt live from what the owner
 * types: name, logo, colour, corners, first location and deposit.
 */
export function LivePreview({
  name, logoUrl, brandColor, radius, location, depositPercent, currency, mode,
}: {
  name: string; logoUrl: string | null; brandColor: string; radius: RadiusOption;
  location: { name?: string; city?: string; lat?: number; lng?: number };
  depositPercent: number; currency: string; mode: 'light' | 'dark';
}) {
  const p = useMemo(() => buildPalette(/^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#2450C8'), [brandColor]);
  const t = p[mode];
  const style = {
    '--brand': t.brand, '--brand-fg': t.brandFg, '--brand-strong': t.brandStrong, '--brand-soft': t.brandSoft,
    '--brand-text': t.brandText, '--radius': `${RADIUS_OPTIONS[radius]?.px ?? 10}px`,
  } as React.CSSProperties;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const total = 1250;
  const deposit = Math.round((total * depositPercent) / 100);

  return (
    <div data-theme={mode} style={style} className="overflow-hidden rounded-[18px] border border-line bg-bg text-ink shadow-pop">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 truncate rounded-full bg-surface-2 px-3 py-0.5 text-[11px] text-muted">your-app/{(name || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22)}</span>
      </div>
      <div className="flex min-h-[340px]">
        <div className="hidden w-36 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 sm:flex">
          <motion.div layout className="mb-3 flex min-w-0 items-center gap-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className={`h-7 max-w-full object-contain ${mode === 'dark' ? 'rounded bg-white px-1' : ''}`} />
            ) : (
              <>
                <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-ui-sm text-xs font-bold text-brand-fg">{(name || 'Y').slice(0, 1).toUpperCase()}</span>
                <span className="truncate text-xs font-semibold">{name || 'Your business'}</span>
              </>
            )}
          </motion.div>
          {[{ i: LayoutDashboard, l: 'Dashboard', a: true }, { i: ClipboardList, l: 'Orders' }, { i: CalendarDays, l: 'Calendar' }, { i: Users, l: 'Customers' }].map((x) => (
            <span key={x.l} className={`flex items-center gap-2 rounded-ui-sm px-2 py-1.5 text-[11px] ${x.a ? 'bg-brand-soft font-semibold text-brand-text' : 'text-muted'}`}>
              <x.i aria-hidden className="size-3.5" /> {x.l}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="brand-gradient relative overflow-hidden rounded-ui p-4 text-brand-fg">
            <div className="absolute -right-6 -top-8 size-28 rounded-full bg-white/15" />
            <p className="text-[11px] opacity-80">Saturday</p>
            <p className="truncate font-display text-lg font-bold">{name ? `${name}` : 'Your business'}</p>
            <p className="text-[11px] opacity-90">3 events today · 2 crews out</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-ui-sm border border-line bg-surface p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Bookings this week</p>
              <p className="font-display text-xl font-bold"><AnimatedNumber value={18} /></p>
            </div>
            <div className="rounded-ui-sm border border-line bg-surface p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Deposits taken</p>
              <p className="font-display text-xl font-bold text-brand-text">{money.format(deposit * 6)}</p>
            </div>
          </div>
          <div className="rounded-ui-sm border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold">Q-01042 · Bounce House + Slide</p>
              <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand-text">Booked</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {money.format(total)} · <motion.span key={depositPercent} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} className="font-medium text-ink">{depositPercent}% deposit {money.format(deposit)}</motion.span> paid
            </p>
            <div className="mt-2 flex gap-2">
              <span className="rounded-ui-sm bg-brand px-2.5 py-1 text-[10px] font-semibold text-brand-fg">Send invoice</span>
              <span className="rounded-ui-sm border border-line px-2.5 py-1 text-[10px] font-medium">View</span>
            </div>
          </div>
          <div className="overflow-hidden rounded-ui-sm border border-line bg-surface">
            <StaticMap lat={location.lat} lng={location.lng} width={420} height={110} zoom={12} className="h-[90px] w-full" label="Location map" />
            <p className="flex items-center gap-1.5 px-3 py-2 text-[11px]">
              <MapPin aria-hidden className="size-3.5 text-brand-text" />
              <span className="truncate"><strong>{location.name || 'Your first location'}</strong>{location.city ? ` · ${location.city}` : ''}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
