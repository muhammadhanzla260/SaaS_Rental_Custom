import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { OrgError } from '@rental/db';
import type { ActionResult } from '@/lib/result';
import { ActionError } from '../context';

/** Turns expected errors into a friendly result; anything else is logged and hidden. */
export async function run<T = undefined>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof OrgError || e instanceof ActionError) return { ok: false, error: e.message };
    console.error('[action]', e);
    return { ok: false, error: 'Something went wrong on our side. Please try again.' };
  }
}

export async function readUpload(file: FormDataEntryValue | null) {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  return { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: file.name || 'upload' };
}
