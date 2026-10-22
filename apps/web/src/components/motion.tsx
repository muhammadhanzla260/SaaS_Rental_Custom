'use client';

import { animate, motion, MotionConfig, useInView, useMotionValue, useTransform, type HTMLMotionProps } from 'motion/react';
import { useEffect, useRef } from 'react';

/** Respects the system "reduce motion" setting for every animation below it. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and rises into place. */
export function Reveal({ delay = 0, y = 14, ...rest }: HTMLMotionProps<'div'> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay }}
      {...rest}
    />
  );
}

/** Children marked <StaggerItem> appear one after another. */
export function Stagger({ gap = 0.06, delay = 0, as = 'div', ...rest }: HTMLMotionProps<'div'> & { gap?: number; delay?: number; as?: 'div' | 'ul' | 'ol' }) {
  const Comp = as === 'ul' ? motion.ul : as === 'ol' ? motion.ol : motion.div;
  return (
    <Comp
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
      {...(rest as object)}
    />
  );
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

export function StaggerItem({ as = 'div', ...rest }: HTMLMotionProps<'div'> & { as?: 'div' | 'li' }) {
  const Comp = as === 'li' ? motion.li : motion.div;
  return <Comp variants={itemVariants} {...(rest as object)} />;
}

/** Card that lifts slightly under the pointer. */
export function Lift({ className, ...rest }: HTMLMotionProps<'div'>) {
  return <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }} className={className} {...rest} />;
}

/** Counts up to `value` when it scrolls into view. */
export function AnimatedNumber({ value, decimals = 0, suffix = '', prefix = '' }: { value: number; decimals?: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${prefix}${v.toFixed(decimals)}${suffix}`);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, value, { duration: 0.9, ease: EASE });
    return () => controls.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className="tabular">{text}</motion.span>;
}

/** Circular progress that draws itself. */
export function ProgressRing({ value, size = 88, stroke = 9, label }: { value: number; size?: number; stroke?: number; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-gradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}
        />
      </svg>
      <span className="absolute font-display text-xl font-bold">
        <AnimatedNumber value={Math.round(pct * 100)} suffix="%" />
      </span>
    </div>
  );
}

/** Horizontal bar that fills to `value` (0-1). */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-line ${className ?? ''}`} aria-hidden>
      <motion.div
        className="brand-gradient h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ duration: 0.7, ease: EASE }}
      />
    </div>
  );
}

export { motion, EASE };
