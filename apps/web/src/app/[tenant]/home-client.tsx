'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { useEffect, useOptimistic, useState, useTransition } from 'react';
import { cx, useToast } from '@/components/kit';
import { localTime } from '@/components/fields/timezone-select';
import { setSetupItemAction } from '@/server/actions/settings';

/** Local time at a location, updated every 30 s ("2:40 AM"). */
export function LiveClock({ tz }: { tz: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="mono flex shrink-0 items-center gap-1.5 text-sm font-semibold text-fg">
      <span className="anim-blink size-1.5 rounded-full bg-success" aria-hidden="true" />
      {now ? localTime(tz, now) : '—'}
    </span>
  );
}

export function SetupItem({
  slug, id, title, text, done, auto, cta, href, editable, delay,
}: { slug: string; id: string; title: string; text: string; done: boolean; auto: boolean; cta: string; href: string; editable: boolean; delay: number }) {
  const router = useRouter();
  const toast = useToast();
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  const toggle = () =>
    start(async () => {
      setOptimistic(!optimistic);
      const r = await setSetupItemAction(slug, id, !optimistic);
      if (!r.ok) toast(r.error, 'error');
      router.refresh();
    });
  return (
    <li className="lift anim-rise flex items-center gap-4 rounded-[14px] border border-subtle bg-surface px-4 py-4 sm:px-5" style={{ ['--d' as string]: `${delay}ms` }}>
      <button
        type="button"
        onClick={toggle}
        disabled={!editable}
        aria-pressed={optimistic}
        aria-label={optimistic ? `${title}: done${editable ? '. Click to undo.' : ''}` : `Mark “${title}” as done`}
        title={auto ? 'Done automatically from your settings' : undefined}
        className={cx(
          'press grid size-7 shrink-0 place-items-center rounded-full border-2 transition-[background-color,border-color] duration-250',
          optimistic ? 'border-success bg-success text-white' : 'border-control bg-surface hover:border-accent',
          !editable && 'cursor-default',
        )}
      >
        {optimistic && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path className="anim-tick" d="m5 12 5 5 9-10" /></svg>}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cx('font-semibold text-fg', optimistic && 'line-through decoration-fg-3')}>{title}</p>
        <p className="mt-0.5 text-[13px] text-fg-2">{text}</p>
      </div>
      {!optimistic && (
        <Link href={href} className="press inline-flex h-9 shrink-0 items-center rounded-[var(--radius-control)] border border-control bg-surface px-3.5 text-[13px] font-semibold text-fg hover:bg-hover">
          {cta}
        </Link>
      )}
      {optimistic && auto && <Check className="size-4 shrink-0 text-success max-sm:hidden" aria-hidden="true" />}
    </li>
  );
}
