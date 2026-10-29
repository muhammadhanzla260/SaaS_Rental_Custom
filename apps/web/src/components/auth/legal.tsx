import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/kit';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-[var(--gutter)] py-12">
      <Link href="/sign-in"><Wordmark dark /></Link>
      <h1 className="mt-10 font-display text-4xl font-extrabold tracking-[-0.02em] text-fg">{title}</h1>
      <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-fg-2">{children}</div>
    </main>
  );
}
