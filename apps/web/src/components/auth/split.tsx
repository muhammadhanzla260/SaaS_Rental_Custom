import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark, PRODUCT_NAME } from '@/components/kit';

/** Two-panel auth screen: ink story on the left (desktop), the form on the right. */
export function AuthSplit({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <aside className="ink-grid relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:px-[clamp(40px,4.5vw,88px)] lg:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgb(44_79_224/0.35),transparent_65%)]" />
        <Link href="/sign-in" className="relative inline-flex items-center gap-2.5">
          <BrandMark size={44} />
          <span className="font-display text-2xl font-bold tracking-[-0.01em]">{PRODUCT_NAME}</span>
        </Link>
        <div className="relative flex flex-1 flex-col justify-center py-10">{hero}</div>
      </aside>
      <main id="main" className="flex min-w-0 flex-col bg-canvas px-[var(--gutter)] pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Link href="/sign-in" className="mb-10 inline-flex items-center gap-2.5 self-start lg:hidden">
          <BrandMark size={34} dark />
          <span className="font-display text-xl font-bold tracking-[-0.01em] text-fg">{PRODUCT_NAME}</span>
        </Link>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">{children}</div>
      </main>
    </div>
  );
}

export function HeroTitle({ children }: { children: ReactNode }) {
  return <h1 className="anim-rise font-display text-[clamp(44px,5.6vw,84px)] font-extrabold leading-[0.95] tracking-[-0.035em]">{children}</h1>;
}

export function HeroSub({ children }: { children: ReactNode }) {
  return <p className="anim-rise mt-6 max-w-xl text-lg leading-relaxed text-[#A3ABB9]" style={{ ['--d' as string]: '120ms' }}>{children}</p>;
}

/** Sample day view: bookings with hatched cleanup buffers and a live "now" line (illustration only). */
export function CalendarIllustration() {
  const rows = [
    { name: 'Bounce house', meta: '2 owned', bars: [{ id: 'Q-AUS-01042', l: 17, w: 23, buf: 13, tone: 'accent' }, { id: 'Q-AUS-01047', l: 34, w: 18, buf: 13, tone: 'accent' }] },
    { name: 'LED screen #1', meta: 'serialized', bars: [{ id: 'Q-AUS-01051', l: 66, w: 18, buf: 15, tone: 'volt' }] },
    { name: 'Popcorn machine', meta: '1 owned', bars: [{ id: 'Q-AUS-01039', l: 8, w: 15, buf: 14, tone: 'light' }] },
  ];
  return (
    <figure className="anim-rise mt-14 max-w-[640px] rounded-[20px] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm" style={{ ['--d' as string]: '240ms' }} aria-label="Illustration of a booking calendar with cleanup buffers">
      <div className="mb-4 flex items-center justify-between text-sm">
        <span className="font-semibold">Saturday · Austin</span>
        <span className="flex items-center gap-4 text-[13px] text-[#A3ABB9]">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#2C4FE0]" />Booked</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-white/40" />Cleanup buffer</span>
        </span>
      </div>
      <div className="relative">
        <div className="mono ml-[28%] grid grid-cols-4 pb-2 text-[11px] text-[#7D8594]">
          {['10:00', '14:00', '18:00', '22:00'].map((t) => <span key={t}>{t}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.name} className="flex items-center border-t border-white/8 py-3">
            <div className="w-[28%] shrink-0 pr-3">
              <p className="text-sm font-semibold">{r.name}</p>
              <p className="mono text-[11px] text-[#7D8594]">{r.meta}</p>
            </div>
            <div className="relative h-9 flex-1">
              {r.bars.map((b) => (
                <div key={b.id} className="absolute inset-y-0 flex" style={{ left: `${b.l}%`, width: `${b.w + b.buf}%` }}>
                  <span
                    className={`mono flex items-center truncate rounded-l-md px-2 text-[11px] font-semibold ${b.tone === 'accent' ? 'bg-[#2C4FE0] text-white' : b.tone === 'volt' ? 'bg-volt text-night' : 'bg-white text-night'}`}
                    style={{ width: `${(b.w / (b.w + b.buf)) * 100}%` }}
                  >
                    {b.id}
                  </span>
                  <span className="flex-1 rounded-r-md border border-white/15 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.12)_0_4px,transparent_4px_9px)]" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <span aria-hidden="true" className="absolute inset-y-6 left-[calc(28%+11%)] w-0.5 rounded-full bg-volt shadow-[0_0_12px_#D4FF3A]" />
      </div>
      <figcaption className="mt-3 text-xs text-[#7D8594]">Sample bookings shown for illustration.</figcaption>
    </figure>
  );
}
