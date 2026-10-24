'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { endSupportSessionAction } from '@/server/actions/platform';

export function EndSupportButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await endSupportSessionAction(); router.push('/console'); })}
      className="rounded-md bg-white/20 px-2.5 py-1 text-xs font-bold hover:bg-white/30 disabled:opacity-60"
    >
      {pending ? 'Ending…' : 'End session'}
    </button>
  );
}
