'use client';

import { useCallback, useState, useTransition } from 'react';
import type { ActionResult } from './result';

/** Immutable set of a dotted path: setIn(obj, 'address.city', 'Austin'), 'hours.2.open'. */
export function setIn<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const key = head as string;
  const source = (obj ?? {}) as Record<string, unknown>;
  const copy = (Array.isArray(source) ? [...source] : { ...source }) as Record<string, unknown>;
  copy[key] = rest.length ? setIn(source[key], rest.join('.'), value) : value;
  return copy as T;
}

export function getIn(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), obj);
}

/**
 * Client form state + a server action call with pending state, field errors
 * and a status message. Field errors are keyed by dotted path.
 */
export function useForm<T>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = useCallback((path: string, value: unknown) => {
    setValues((prev) => setIn(prev, path, value));
    setErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setDirty(true);
    setStatus(null);
  }, []);

  const submit = useCallback(
    <R,>(action: () => Promise<ActionResult<R>>, onOk?: (r: ActionResult<R> & { ok: true }) => void) => {
      startTransition(async () => {
        const res = await action();
        if (res.ok) {
          setErrors({});
          setDirty(false);
          setStatus(res.message ? { kind: 'ok', text: res.message } : null);
          onOk?.(res);
        } else {
          setErrors(res.fieldErrors ?? {});
          setStatus({ kind: 'error', text: res.error });
        }
      });
    },
    [],
  );

  const error = useCallback((path: string) => errors[path], [errors]);

  /** Back to these values with no errors and nothing unsaved (Discard, or after a save). */
  const reset = useCallback((next: T) => {
    setValues(next);
    setErrors({});
    setStatus(null);
    setDirty(false);
  }, []);

  return { values, setValues, set, errors, setErrors, error, status, setStatus, pending, submit, dirty, reset };
}
