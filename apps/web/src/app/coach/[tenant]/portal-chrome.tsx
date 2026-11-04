'use client';

import { ClipboardList, LayoutDashboard, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GPS_PING_SECONDS } from '@rental/core';
import { Avatar, cx } from '@/components/kit';
import { activeTrackingAction, pingAction } from '@/server/actions/coach';
import { watchFix, type ClientFix } from './gps';

type Tracking = {
  /** The order whose GPS is being sent (one at a time), or null. */
  orderId: string | null;
  etaMinutes: number | null;
  /** Start sending pings for an order (after Start En Route / Start Tracking). */
  start: (orderId: string, etaMinutes: number | null) => void;
  /** Stop sending (Stop Tracking, arrival, Text 2). */
  stop: () => void;
};

const TrackingContext = createContext<Tracking | null>(null);
export const useTracking = () => useContext(TrackingContext)!;

/**
 * App bar, bottom navigation and the live-tracking engine: while an order is tracked, the phone's
 * latest fix goes to the server every 25 s; the server answers when to stop (Text 2, arrival).
 * Reopening the app resumes the one order that is still tracked.
 */
export function PortalChrome({
  slug, orgName, logoUrl, user, readOnly, children,
}: { slug: string; orgName: string; logoUrl: string | null; user: { name: string; image: string | null }; readOnly: boolean; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const fix = useRef<ClientFix | null>(null);

  const start = useCallback((id: string, etaMinutes: number | null) => {
    setOrderId(id);
    setEta(etaMinutes);
  }, []);
  const stop = useCallback(() => setOrderId(null), []);

  // Resume after the app was closed while en route.
  useEffect(() => {
    if (readOnly) return;
    activeTrackingAction(slug).then((r) => {
      if (r.ok && r.data) start(r.data.orderId, r.data.etaMinutes);
    });
  }, [slug, readOnly, start]);

  useEffect(() => {
    if (!orderId) return;
    const unwatch = watchFix((f) => { fix.current = f; });
    let alive = true;
    const send = async () => {
      const f = fix.current;
      if (!f || !alive) return;
      const r = await pingAction(slug, orderId, f);
      if (!alive || !r.ok || !r.data) return;
      if (r.data.etaMinutes != null) setEta(r.data.etaMinutes);
      if (!r.data.tracking) {
        setOrderId(null);
        // Text 2 went out or tracking stopped elsewhere: show it on the order page.
        router.refresh();
      }
    };
    const timer = window.setInterval(send, GPS_PING_SECONDS * 1000);
    const first = window.setTimeout(send, 4000);
    return () => {
      alive = false;
      unwatch();
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [orderId, slug, router]);

  const value = useMemo(() => ({ orderId, etaMinutes: eta, start, stop }), [orderId, eta, start, stop]);
  const base = `/coach/${slug}`;
  const tabs = [
    { href: base, label: 'Dashboard', icon: LayoutDashboard, active: path === base },
    { href: `${base}/orders`, label: 'Orders', icon: ClipboardList, active: path.startsWith(`${base}/orders`) },
    { href: `${base}/account`, label: 'Account', icon: UserRound, active: path.startsWith(`${base}/account`) },
  ];

  return (
    <TrackingContext.Provider value={value}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-canvas">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-subtle bg-surface/90 px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] backdrop-blur">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-[10px] object-contain" />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent font-display text-sm font-bold text-on-accent">{orgName.slice(0, 1)}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-bold leading-tight text-fg">{orgName}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Coach Portal</p>
          </div>
          {orderId && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-night px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-volt" role="status">
              <span className="relative grid size-2 place-items-center">
                <span className="anim-halo absolute inset-0 rounded-full bg-volt" />
                <span className="relative size-2 rounded-full bg-volt" />
              </span>
              Live{eta != null ? ` · ${eta} min` : ''}
            </span>
          )}
          <Link href={`${base}/account`} aria-label="Account">
            <Avatar name={user.name} src={user.image} size={34} />
          </Link>
        </header>

        {readOnly && <p role="status" className="bg-warning-bg px-4 py-2 text-center text-[12px] font-semibold text-warning-fg">Read-only: nothing can be changed here.</p>}

        <main id="main" className="flex-1 px-4 pb-28 pt-4">{children}</main>

        <nav aria-label="Coach portal" className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[560px] border-t border-subtle bg-surface/95 pb-[max(6px,env(safe-area-inset-bottom))] backdrop-blur">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={cx('press flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] font-semibold', t.active ? 'text-accent-text' : 'text-fg-3')}
            >
              <t.icon className="size-[22px]" strokeWidth={t.active ? 2.4 : 1.9} />
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </TrackingContext.Provider>
  );
}
