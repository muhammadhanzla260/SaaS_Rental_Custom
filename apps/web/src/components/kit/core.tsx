import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// --- Button ---------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger' | 'volt' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent shadow-[0_6px_16px_-8px_var(--accent)] hover:bg-accent-hover',
  secondary: 'border border-control bg-surface text-fg hover:bg-hover hover:border-fg-3',
  ghost: 'bg-transparent text-fg-2 hover:bg-sunken hover:text-fg',
  dark: 'bg-night text-volt hover:bg-night-2',
  danger: 'bg-danger text-white hover:brightness-95',
  'danger-ghost': 'border border-control bg-surface text-danger hover:bg-danger-bg hover:border-danger/40',
  volt: 'bg-volt text-night hover:brightness-95',
};
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2 max-sm:h-11',
  lg: 'h-12 px-5 text-[15px] gap-2',
};
export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  cx(
    'press inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] font-semibold leading-none',
    'transition-[background-color,border-color,box-shadow,filter] duration-200 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-sunken disabled:text-fg-3 disabled:shadow-none',
    VARIANT[variant],
    SIZE[size],
    extra,
  );

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; pending?: boolean; icon?: ReactNode };

export function Button({ variant = 'primary', size = 'md', pending, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {pending ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ variant = 'primary', size = 'md', icon, className, children, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'press inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-subtle bg-surface text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-50 max-sm:size-10',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextLink({ className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx('font-medium text-accent-text underline-offset-2 hover:underline', className)} {...rest} />;
}

// --- Status pills and chips --------------------------------------------------------

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'strong' | 'teal' | 'violet' | 'pink' | 'owner';

const TONE: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg',
  info: 'bg-info-bg text-info-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  strong: 'bg-night text-volt',
  owner: 'bg-night text-volt',
  teal: 'bg-teal-bg text-teal-fg',
  violet: 'bg-violet-bg text-violet-fg',
  pink: 'bg-pink-bg text-pink-fg',
};

/** Status is never colour alone: a dot, a word and a tone. */
export function Pill({ tone = 'neutral', dot = true, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold', TONE[tone], className)}>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('mono inline-flex h-6 items-center rounded-md border border-subtle bg-surface px-1.5 text-[11px] font-semibold text-fg', className)}>
      {children}
    </span>
  );
}

// --- Cards, page structure -----------------------------------------------------------

export function Card({ className, children, as: As = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('rounded-[var(--radius-card)] border border-subtle bg-surface', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, sub, actions, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="font-sans text-base font-bold tracking-tight text-fg">{title}</h2>
        {sub && <p className="mt-1 text-[13px] text-fg-2">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageTitle({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="anim-rise mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg sm:text-[34px] lg:text-[40px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-fg-2 sm:text-base">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone, className, style }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'info' | 'warning' | 'danger'; className?: string; style?: React.CSSProperties }) {
  const color = tone === 'success' ? 'text-success' : tone === 'info' ? 'text-accent-text' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg';
  return (
    <div className={cx('lift anim-rise flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-subtle bg-surface px-5 py-4', className)} style={style}>
      <span className="text-[13px] text-fg-2">{label}</span>
      <span className={cx('font-display text-[30px] font-extrabold leading-none tracking-tight tnum', color)}>{value}</span>
      {sub && <span className="text-xs text-fg-2">{sub}</span>}
    </div>
  );
}

export function EmptyState({ icon, title, sub, action }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-sunken text-fg-2">{icon}</div>}
      <p className="font-semibold text-fg">{title}</p>
      {sub && <p className="mt-1 max-w-sm text-[13px] text-fg-2">{sub}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', children, className }: { kind?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode; className?: string }) {
  const cls = { info: 'bg-info-bg text-info-fg', success: 'bg-success-bg text-success-fg', warning: 'bg-warning-bg text-warning-fg', danger: 'bg-danger-bg text-danger-fg' }[kind];
  return (
    <div role={kind === 'danger' ? 'alert' : 'status'} className={cx('anim-fade rounded-[var(--radius-control)] px-3.5 py-2.5 text-[13px] font-medium', cls, className)}>
      {children}
    </div>
  );
}

// --- Progress -----------------------------------------------------------------------

export function Progress({ value, className, label, tone }: { value: number; className?: string; label?: string; tone?: 'accent' | 'success' | 'volt' }) {
  const v = Math.max(0, Math.min(100, value));
  const fill = tone === 'volt' ? 'bg-volt' : tone === 'success' || v >= 100 ? 'bg-success' : 'bg-accent';
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <div className={cx('anim-grow h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]', fill)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Ring({ value, size = 120, stroke = 10, children, label, track = 'rgb(255 255 255 / 0.1)', color = 'var(--volt)' }: { value: number; size?: number; stroke?: number; children?: ReactNode; label: string; track?: string; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-[var(--ease-out)]"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

// --- Avatars --------------------------------------------------------------------------

const AVATAR_TONES = ['#2C4FE0', '#0B7A55', '#6D3FD6', '#C2410C', '#0E7490', '#B0306A', '#10131A'];

export function Avatar({ name, src, size = 32, round = true, color, className }: { name: string; src?: string | null; size?: number; round?: boolean; color?: string; className?: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const ini = (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const bg = color ?? AVATAR_TONES[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  const shape = round ? 'rounded-full' : 'rounded-[8px]';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    // Logos must never be cropped: fit the whole image on a white tile.
    return <img src={src} alt="" width={size} height={size} className={cx('shrink-0 border border-subtle bg-white object-contain p-0.5', shape, className)} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex shrink-0 items-center justify-center font-bold', shape, className)}
      style={{ width: size, height: size, background: bg, color: bg === '#D4FF3A' ? '#0B0D12' : '#fff', fontSize: Math.max(10, size * 0.38) }}
    >
      {ini}
    </span>
  );
}

/** Platform mark (placeholder product name "Tentpole"). */
export function BrandMark({ size = 30, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-[9px]', dark ? 'bg-night' : 'bg-volt')} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.57} height={size * 0.57} viewBox="0 0 24 24" fill="none" stroke={dark ? '#D4FF3A' : '#0B0D12'} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 3 20h18L12 3Z" />
        <path d="M12 3v17" />
      </svg>
    </span>
  );
}

export const PRODUCT_NAME = 'Tentpole';

export function Wordmark({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <BrandMark dark={dark} />
      <span className={cx('font-display text-lg font-bold tracking-[-0.01em]', dark ? 'text-fg' : 'text-white')}>{PRODUCT_NAME}</span>
    </span>
  );
}
