'use client';

import { LoaderCircle, Mail, Phone, Plus, Search, UserRound, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState, useTransition } from 'react';
import { formatPhone, normalizePhone } from '@rental/core';
import { Button, cx, Field, Input, Notice } from '@/components/ui';
import { saveCustomerAction, searchCustomersAction, type CustomerHit } from '@/server/actions/commerce';

/** Find a customer by name, phone or email, or add one without leaving the order. */
export function CustomerPicker({
  slug, value, onChange, country, invalid,
}: {
  slug: string; value: CustomerHit | null; onChange: (c: CustomerHit | null) => void; country: string; invalid?: boolean;
}) {
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (value || q.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchCustomersAction(slug, q);
      setLoading(false);
      if (r.ok) { setHits(r.data ?? []); setOpen(true); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, slug, value]);

  if (value) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-ui border border-brand/30 bg-brand-soft/50 p-3.5">
        <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-full font-semibold text-brand-fg">
          {value.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{value.name}</span>
          <span className="flex flex-wrap gap-x-3 text-sm text-muted">
            {value.phone && <span className="inline-flex items-center gap-1"><Phone aria-hidden className="size-3.5" />{formatPhone(value.phone, country)}</span>}
            {value.email && <span className="inline-flex min-w-0 items-center gap-1"><Mail aria-hidden className="size-3.5" /><span className="truncate">{value.email}</span></span>}
          </span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); setQ(''); }}>Change</Button>
      </motion.div>
    );
  }

  const create = () =>
    start(async () => {
      setError(null);
      const r = await saveCustomerAction(slug, null, { kind: 'individual', ...draft, address: { country } });
      if (r.ok && r.data) {
        onChange({ id: r.data.id, name: r.data.name, email: draft.email || null, phone: normalizePhone(draft.phone, country) ?? (draft.phone || null), city: null, lat: null, lng: null });
        setCreating(false);
        setDraft({ firstName: '', lastName: '', phone: '', email: '' });
      } else if (!r.ok) {
        setError(r.fieldErrors?.firstName ?? r.fieldErrors?.email ?? r.fieldErrors?.phone ?? r.error);
      }
    });

  return (
    <div className="flex flex-col gap-3">
      {!creating && (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            id="order-customer"
            role="combobox"
            aria-expanded={open && hits.length > 0}
            aria-controls={listId}
            aria-invalid={invalid}
            autoComplete="off"
            placeholder="Search by name, phone or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            className="min-h-12 pl-9 text-[16px]"
          />
          {loading && <LoaderCircle aria-hidden className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
          <AnimatePresence>
            {open && q.trim().length >= 2 && (
              <motion.ul id={listId} role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-ui border border-line bg-surface p-1 shadow-pop">
                {hits.map((h) => (
                  <li key={h.id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(h); setOpen(false); }}
                    className="flex cursor-pointer items-center gap-3 rounded-ui-sm px-3 py-2.5 hover:bg-surface-2">
                    <UserRound aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.name}</span>
                      <span className="block truncate text-sm text-muted">{[formatPhone(h.phone, country), h.email, h.city].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
                <li role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setCreating(true); setOpen(false); const parts = q.trim().split(/\s+/); setDraft({ ...draft, firstName: /\d|@/.test(q) ? '' : parts[0] ?? '', lastName: /\d|@/.test(q) ? '' : parts.slice(1).join(' '), phone: /^\+?[\d\s()-]{7,}$/.test(q) ? q : '', email: q.includes('@') ? q : '' }); }}
                  className={cx('flex cursor-pointer items-center gap-2 rounded-ui-sm px-3 py-2.5 font-medium text-brand-text hover:bg-brand-soft', hits.length > 0 && 'mt-1 border-t border-line')}>
                  <Plus aria-hidden className="size-4" /> New customer{q.trim() ? `: "${q.trim()}"` : ''}
                </li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      {!creating && <button type="button" onClick={() => setCreating(true)} className="self-start text-sm font-medium text-brand-text underline">Or add a new customer</button>}
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 rounded-ui border border-line bg-surface-2/60 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">New customer</span>
                <button type="button" aria-label="Cancel new customer" onClick={() => setCreating(false)} className="grid size-8 place-items-center rounded-ui-sm hover:bg-surface"><X aria-hidden className="size-4" /></button>
              </div>
              {error && <Notice kind="error">{error}</Notice>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="nc-first"><Input id="nc-first" value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} autoComplete="off" /></Field>
                <Field label="Last name" htmlFor="nc-last" optional><Input id="nc-last" value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} autoComplete="off" /></Field>
                <Field label="Mobile" htmlFor="nc-phone"><Input id="nc-phone" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
                <Field label="Email" htmlFor="nc-email" optional><Input id="nc-email" type="email" inputMode="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
              </div>
              <Button type="button" onClick={create} pending={pending} className="self-start">Add customer</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
