'use client';

import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkAccent, HEX_RE, THEME_PRESETS } from '@rental/core';
import { cx } from '@/components/kit';

/** Brand colour: 7 swatches or a custom hex, with the button-text contrast readout. */
export function ThemePicker({ value, onChange, id = 'brand-hex' }: { value: string; onChange: (hex: string) => void; id?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = HEX_RE.test(text);
  const check = checkAccent(valid ? text.toUpperCase() : value);
  const preset = THEME_PRESETS.find((p) => p.hex.toLowerCase() === value.toLowerCase());
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Brand colour">
        {THEME_PRESETS.map((p) => {
          const on = p.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.name}
              title={p.name}
              onClick={() => onChange(p.hex)}
              className={cx('grid size-9 place-items-center rounded-full transition-transform duration-250 ease-[var(--ease-pop)]', on ? 'scale-110' : 'hover:scale-105')}
              style={{ background: p.hex, boxShadow: on ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${p.hex}` : '0 0 0 1px var(--border-control)' }}
            >
              {on && <Check className="anim-pop size-4" style={{ color: checkAccent(p.hex).onAccent }} strokeWidth={3} />}
            </button>
          );
        })}
        <label htmlFor={id} className="ml-1 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">Custom</span>
          <span className="relative">
            <span aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 rounded-full border border-subtle" style={{ background: valid ? text : value }} />
            <input
              id={id}
              value={text}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const t = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                setText(t);
                if (HEX_RE.test(t) && checkAccent(t.toUpperCase()).level !== 'fail') onChange(t.toUpperCase());
              }}
              aria-invalid={!valid || undefined}
              className="mono h-9 w-[118px] rounded-[var(--radius-control)] border border-control bg-surface pl-8 pr-2 text-[13px] uppercase text-fg focus:border-accent focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:outline-none aria-[invalid=true]:border-danger"
            />
          </span>
        </label>
      </div>
      <p
        role="status"
        className={cx('inline-flex w-fit rounded-md px-2 py-1 text-xs font-semibold', !valid ? 'bg-warning-bg text-warning-fg' : check.level === 'all' ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg')}
      >
        {!valid ? 'Enter a 6-digit hex like #2C4FE0' : `${preset ? `${preset.name} · ` : ''}${check.onAccent === '#FFFFFF' ? 'white' : 'dark'} text on buttons · ${check.message.replace('Button text contrast ', 'contrast ')}`}
      </p>
    </div>
  );
}
