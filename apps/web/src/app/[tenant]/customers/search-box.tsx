'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui';

/** Search that updates ?q= as you type (debounced), keeping the list server-rendered. */
export function SearchBox({ initial, placeholder, param = 'q' }: { initial: string; placeholder: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (value === initial) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (value) params.set(param, value);
      else params.delete(param);
      start(() => router.replace(`${pathname}${params.size ? `?${params}` : ''}`));
    }, 300);
    return () => clearTimeout(t);
  }, [value, initial, param, pathname, router]);
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} className="pl-9 pr-9" />
      {pending && <LoaderCircle aria-hidden className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
    </div>
  );
}
