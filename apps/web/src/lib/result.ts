import { z } from 'zod';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Flattens zod issues to { "address.city": "Enter a city" } for inline field errors. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: 'Some fields need attention.', fieldErrors: zodFieldErrors(error) };
}
