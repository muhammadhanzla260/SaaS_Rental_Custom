'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { onMoney } from '@/lib/money-sync';

/** Pages whose figures come from orders and payments (lists, boards, calendar, money, reports). */
const LIVE = /^\/[^/]+(\/(actions|calendar|orders|invoices|customers(\/[^/]+)?|reports))?\/?$/;
const EVERY_MS = 60_000;

/**
 * Keeps money figures current everywhere: a payment in another tab refreshes this
 * page at once, coming back to the tab refreshes it, and visible pages refresh each
 * minute (other people's payments). The order screen is left alone: it has unsaved
 * edits and reloads itself after a payment.
 */
export function LiveRefresh({ slug }: { slug: string }) {
  const router = useRouter();
  const path = usePathname();
  const live = LIVE.test(path);
  const last = useRef(Date.now());

  useEffect(() => {
    if (!live) return;
    const refresh = () => {
      last.current = Date.now();
      router.refresh();
    };
    const off = onMoney(slug, refresh);
    const onShow = () => { if (document.visibilityState === 'visible' && Date.now() - last.current > 5_000) refresh(); };
    const tick = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, EVERY_MS);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      off();
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [live, slug, router]);

  return null;
}
