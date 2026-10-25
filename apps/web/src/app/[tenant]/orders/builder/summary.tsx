'use client';

import { Check } from 'lucide-react';
import type { OrderSummary } from '@rental/core';
import { cx } from '@/components/kit';
import type { BuilderCredit, Draft, DepositRule } from './types';

type SetDraft = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;

/** Dark numeric cell (design: every value editable). */
function Cell({ value, onChange, label, placeholder, width = 'w-20', disabled, title }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; width?: string; disabled?: boolean; title?: string }) {
  return (
    <input
      aria-label={label}
      title={title}
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'mono h-8 rounded-[8px] border border-white/10 bg-white/[0.06] px-2 text-right text-[13px] text-white placeholder:text-white/35',
        'transition-[border-color,box-shadow] focus:border-volt focus:shadow-[0_0_0_3px_rgb(212_255_58/0.18)] focus:outline-none disabled:opacity-60',
        width,
      )}
    />
  );
}

function Row({ label, sub, children, amount, strike, tone }: { label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; amount?: string; strike?: boolean; tone?: 'volt' | 'mint' }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-white/90">{label}</p>
        {sub && <p className="mono truncate text-[11px] text-white/45">{sub}</p>}
      </div>
      {children}
      {amount !== undefined && (
        <span className={cx('mono w-[84px] shrink-0 text-right text-[14px] transition-colors', strike && 'text-white/35 line-through', tone === 'volt' && 'text-volt', tone === 'mint' && 'text-[#3DD39A]', !strike && !tone && 'text-white')}>
          {amount}
        </span>
      )}
    </div>
  );
}

export function SummaryPanel({
  d, set, s, money, travel, taxPercent, credits, totalBeforeCredits, couponMsg, onApplyCoupon, canOverrideTax, exempt, paidCents, readOnly,
}: {
  d: Draft; set: SetDraft; s: OrderSummary; money: (c: number) => string; travel: { cents: number; trace: string; overridden: boolean };
  taxPercent: number; credits: BuilderCredit[]; totalBeforeCredits: number; couponMsg: { ok: boolean; text: string } | null;
  onApplyCoupon: () => void; canOverrideTax: boolean; exempt: boolean; paidCents: number; readOnly: boolean;
}) {
  const due = s.totalCents;
  const DEPOSITS: { value: DepositRule; label: string }[] = [
    { value: '30', label: '30%' }, { value: '50', label: '50%' }, { value: 'full', label: 'Full' }, { value: 'none', label: 'None' }, { value: 'custom', label: 'Custom' },
  ];
  return (
    <section aria-label="Order summary" className="ink-dots overflow-hidden rounded-[var(--radius-panel)] p-5 text-white shadow-[var(--shadow-float)]">
      <fieldset disabled={readOnly} className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="eyebrow !text-white/60">Summary</h2>
          <span className="mono text-[11px] text-white/40">every value editable</span>
        </div>
        <Row label="Rental items" amount={money(s.merchandiseCents)} />
        {s.customCents > 0 && <Row label="Custom items" amount={money(s.customCents)} />}
        <Row label="Damage waiver" strike={!d.damageWaiver} amount={money(d.damageWaiver ? s.damageWaiverCents : Math.round((s.merchandiseCents * parseFloat(d.waiverPercent || '0')) / 100))}>
          <Cell label="Damage waiver percent" value={d.waiverPercent} onChange={(v) => set({ waiverPercent: v })} width="w-14" disabled={!d.damageWaiver} />
          <span className="text-[13px] text-white/50">%</span>
          <button type="button" onClick={() => set({ damageWaiver: !d.damageWaiver })} className="h-7 rounded-md border border-white/15 px-2 text-[11px] font-semibold text-white/75 hover:bg-white/10">
            {d.damageWaiver ? 'Declined?' : 'Add back'}
          </button>
        </Row>
        {s.setupSurfaceCents > 0 && <Row label="Setup surface" amount={money(s.setupSurfaceCents)} />}
        {s.eventLocationCents > 0 && <Row label="Event location fee" amount={money(s.eventLocationCents)} />}
        <Row label="Travel fee" sub={travel.trace || undefined}>
          <Cell label="Travel fee override" value={d.travelOverride ?? ''} placeholder={(travel.cents / 100).toFixed(2)} width="w-24"
            onChange={(v) => set({ travelOverride: v.trim() === '' ? null : v })} title="Leave empty to work it out from the distance" />
        </Row>
        <Row label="Discount" amount={s.preTaxDiscountCents ? `−${money(s.preTaxDiscountCents)}` : money(0)} tone={s.preTaxDiscountCents ? 'mint' : undefined}>
          <span className="flex rounded-[8px] bg-white/[0.06] p-0.5" role="radiogroup" aria-label="Discount kind">
            {(['percent', 'amount'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={d.discountKind === k} onClick={() => set({ discountKind: k })}
                className={cx('h-7 w-7 rounded-[6px] text-[12px] font-bold', d.discountKind === k ? 'bg-volt text-night' : 'text-white/60')}>{k === 'percent' ? '%' : '$'}</button>
            ))}
          </span>
          <Cell label="Discount value" value={d.discountValue} onChange={(v) => set({ discountValue: v })} placeholder="0" width="w-16" />
        </Row>
        <Row label="Coupon" sub={couponMsg?.text} amount={s.couponCents ? `−${money(s.couponCents)}` : undefined} tone="mint">
          <form className="flex" onSubmit={(e) => { e.preventDefault(); onApplyCoupon(); }}>
            <input
              aria-label="Coupon code"
              value={d.couponCode}
              onChange={(e) => set({ couponCode: e.target.value.toUpperCase(), ...(d.coupon && e.target.value.toUpperCase() !== d.coupon.code ? { coupon: null } : {}) })}
              onBlur={onApplyCoupon}
              placeholder="CODE"
              className={cx('mono h-8 w-24 rounded-[8px] border bg-white/[0.06] px-2 text-[13px] uppercase text-white placeholder:text-white/35 focus:outline-none',
                couponMsg ? (couponMsg.ok ? 'border-[#3DD39A]' : 'border-[#FF6B6B]') : 'border-white/10 focus:border-volt')}
            />
          </form>
        </Row>
        <Row label="Sales tax" sub={exempt && !d.taxOverridden ? 'Tax-exempt customer' : undefined} amount={money(s.taxCents)}>
          <Cell label="Tax rate percent" value={d.taxOverridden ? d.taxPercent : String(taxPercent)} width="w-16" disabled={!canOverrideTax}
            title={canOverrideTax ? undefined : 'Your role cannot change the tax rate'}
            onChange={(v) => set({ taxPercent: v, taxOverridden: true })} />
          <span className="text-[13px] text-white/50">%</span>
        </Row>
        {d.taxOverridden && canOverrideTax && (
          <button type="button" onClick={() => set({ taxOverridden: false })} className="mb-1 text-[11px] font-semibold text-volt hover:underline">Use the location’s rate</button>
        )}

        <div className="my-3 border-t border-white/10" />
        <div className="flex items-baseline justify-between">
          <span className="text-[17px] font-semibold">Total</span>
          <span key={totalBeforeCredits} className="mono anim-fade text-[34px] font-bold tracking-tight">{money(totalBeforeCredits)}</span>
        </div>

        {credits.length > 0 && (
          <div className="mt-3 rounded-[14px] border border-white/10 bg-white/[0.04] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#9FD8FF]">Rain checks & credits</span>
              <span className="text-[11px] text-white/40">applied after tax</span>
            </div>
            {credits.map((c) => {
              const st = d.credits[c.id] ?? { on: false, amount: (c.balanceCents / 100).toFixed(2) };
              return (
                <div key={c.id} className="flex items-center gap-2 py-1.5">
                  <button type="button" role="checkbox" aria-checked={st.on} aria-label={`Apply ${c.code}`}
                    onClick={() => set((x) => ({ credits: { ...x.credits, [c.id]: { ...st, on: !st.on } } }))}
                    className={cx('grid size-[18px] shrink-0 place-items-center rounded-[5px] border', st.on ? 'border-volt bg-volt text-night' : 'border-white/30')}>
                    {st.on && <Check className="size-3" strokeWidth={3.5} />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{c.label} <span className="mono font-normal text-white/60">{c.code}</span></span>
                    <span className="mono block truncate text-[11px] text-white/45">
                      {[c.reason, c.validUntil ? `valid to ${c.validUntil}` : null, `${money(c.balanceCents)} available`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Cell label={`${c.code} amount to apply`} value={st.amount} width="w-20" disabled={!st.on}
                    onChange={(v) => set((x) => ({ credits: { ...x.credits, [c.id]: { ...st, amount: v } } }))} />
                </div>
              );
            })}
          </div>
        )}
        {(credits.length > 0 || s.creditCents > 0) && (
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-[14px] font-semibold">Due after credits</span>
            <span className="mono text-[20px] font-bold text-volt">{money(due)}</span>
          </div>
        )}

        <div className="mt-4 rounded-[14px] border border-volt/40 bg-volt/[0.06] p-3.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-semibold text-volt">Deposit to book</span>
            <span className="mono text-[20px] font-bold text-volt">{money(s.depositCents)}</span>
          </div>
          <div role="radiogroup" aria-label="Deposit" className="mt-3 grid grid-cols-5 gap-1">
            {DEPOSITS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={d.depositRule === o.value} onClick={() => set({ depositRule: o.value })}
                className={cx('h-8 rounded-[8px] border text-[12px] font-semibold transition-colors', d.depositRule === o.value ? 'border-volt bg-volt text-night' : 'border-white/15 text-white/80 hover:bg-white/10')}>
                {o.label}
              </button>
            ))}
          </div>
          {d.depositRule === 'custom' && (
            <div className="anim-fade mt-2 flex items-center gap-2">
              <span className="flex rounded-[8px] bg-white/[0.06] p-0.5" role="radiogroup" aria-label="Custom deposit kind">
                {(['percent', 'amount'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={d.depositCustomKind === k} onClick={() => set({ depositCustomKind: k })}
                    className={cx('h-7 w-7 rounded-[6px] text-[12px] font-bold', d.depositCustomKind === k ? 'bg-volt text-night' : 'text-white/60')}>{k === 'percent' ? '%' : '$'}</button>
                ))}
              </span>
              <Cell label="Custom deposit" value={d.depositCustomValue} onChange={(v) => set({ depositCustomValue: v })} placeholder={d.depositCustomKind === 'percent' ? '25' : '100.00'} width="w-24" />
            </div>
          )}
          <div className="mt-3 flex items-baseline justify-between text-[13px]">
            <span className="text-white/65">Balance due on event day</span>
            <span className="mono text-white">{money(Math.max(0, due - s.depositCents))}</span>
          </div>
          {paidCents > 0 && (
            <div className="mt-1 flex items-baseline justify-between text-[13px]">
              <span className="text-white/65">Paid so far</span>
              <span className="mono text-[#3DD39A]">{money(paidCents)}</span>
            </div>
          )}
        </div>
      </fieldset>
    </section>
  );
}
