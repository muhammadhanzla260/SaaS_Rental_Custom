import { passwordScore } from '@rental/core';

const COLORS = ['#C2272D', '#A85A00', '#2C4FE0', '#0B7A55'];

/** 4-segment strength meter under a password field (design 01 · Register). */
export function PasswordMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  return (
    <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-1 rounded-full transition-colors duration-300" style={{ background: i < score ? COLORS[score - 1] : 'var(--border-subtle)' }} />
      ))}
    </div>
  );
}
