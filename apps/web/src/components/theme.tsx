'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Light/dark handling. The organisation sets a default (data-theme-default on
 * <html>, written by the tenant layout); each person can override it, stored
 * in localStorage. Runs before paint to avoid a flash of the wrong theme.
 */

/** Applies an organisation's default mode on client navigation between tenants. */
export function TenantThemeDefault({ mode }: { mode: string }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme-default', mode);
    applyTheme();
  }, [mode]);
  return null;
}

function applyTheme() {
  const d = document.documentElement;
  let pref = 'system';
  try {
    pref = localStorage.getItem('theme-override') || d.getAttribute('data-theme-default') || 'system';
  } catch {}
  const mode = pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
  d.setAttribute('data-theme', mode);
}

const ORDER = ['system', 'light', 'dark'] as const;

export function ThemeToggle() {
  const [pref, setPref] = useState<(typeof ORDER)[number] | null>(null);
  useEffect(() => {
    try {
      setPref((localStorage.getItem('theme-override') as (typeof ORDER)[number]) || 'system');
    } catch {
      setPref('system');
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, []);
  const next = () => {
    const n = ORDER[(ORDER.indexOf(pref ?? 'system') + 1) % ORDER.length]!;
    try {
      if (n === 'system') localStorage.removeItem('theme-override');
      else localStorage.setItem('theme-override', n);
    } catch {}
    setPref(n);
    applyTheme();
  };
  const Icon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor;
  const label = pref === 'dark' ? 'Dark' : pref === 'light' ? 'Light' : 'Device';
  return (
    <button
      type="button"
      onClick={next}
      className="inline-flex min-h-9 items-center gap-2 rounded-ui-sm px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-ink"
      title={`Appearance: ${label}. Click to change.`}
    >
      <Icon aria-hidden className="size-4" />
      <span>{label}</span>
    </button>
  );
}
