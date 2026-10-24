'use client';

import { useEffect } from 'react';
import { Button } from './core';

/** Sticky bar shown while a settings form has unsaved changes; warns before leaving the page. */
export function SaveBar({ dirty, pending, onSave, onDiscard, readOnly, label = 'Save changes' }: { dirty: boolean; pending: boolean; onSave: () => void; onDiscard: () => void; readOnly?: boolean; label?: string }) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!dirty && !pending) return null;
  return (
    <div className="pointer-events-none sticky bottom-[max(16px,env(safe-area-inset-bottom))] z-30 mt-6 flex justify-center">
      <div role="region" aria-label="Unsaved changes" className="anim-rise pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-[16px] bg-night px-4 py-3 text-sm text-white shadow-[var(--shadow-float)]">
        <span className="anim-blink size-2 shrink-0 rounded-full bg-warning-mark" aria-hidden="true" />
        <span className="flex-1 font-medium">{readOnly ? 'Read-only: changes cannot be saved' : 'Unsaved changes'}</span>
        <Button variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={onDiscard} disabled={pending}>Discard</Button>
        <Button variant="volt" size="sm" onClick={onSave} pending={pending} disabled={readOnly}>{label}</Button>
      </div>
    </div>
  );
}
