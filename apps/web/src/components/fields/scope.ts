/** A slice of a form: relative paths, so the same fields work in onboarding and settings. */
export type Scope = {
  id: string;
  v: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  set: (path: string, value: unknown) => void;
  err: (path: string) => string | undefined;
};

export function scope(
  form: { values: unknown; set: (p: string, v: unknown) => void; error: (p: string) => string | undefined },
  prefix: string,
): Scope {
  const v = prefix
    ? prefix.split('.').reduce<any>((acc, k) => acc?.[k], form.values) ?? {} // eslint-disable-line @typescript-eslint/no-explicit-any
    : (form.values as Record<string, unknown>);
  const p = (path: string) => (prefix ? `${prefix}.${path}` : path);
  return { id: prefix.replace(/\./g, '-') || 'f', v, set: (path, value) => form.set(p(path), value), err: (path) => form.error(p(path)) };
}

export const fid = (s: Scope, name: string) => `${s.id}-${name.replace(/\./g, '-')}`;
