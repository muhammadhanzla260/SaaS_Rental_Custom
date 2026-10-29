'use client';

import { Printer } from 'lucide-react';
import type { ReactNode } from 'react';

// Documents are paper: always light, whatever the viewer's theme.
const LIGHT = `document.documentElement.setAttribute('data-theme','light')`;

/** A printable page: paper-white, one column, with a "Save as PDF" button that does not print. */
export function PrintShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 print:bg-white print:p-0">
      <script dangerouslySetInnerHTML={{ __html: LIGHT }} />
      <div className="mx-auto mb-4 flex max-w-[780px] flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-fg-2">{title}</p>
        <button type="button" onClick={() => window.print()} className="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-on-accent">
          <Printer className="size-4" /> Print or save as PDF
        </button>
      </div>
      <main id="main" className="mx-auto max-w-[780px] rounded-[var(--radius-panel)] border border-subtle bg-surface p-5 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0">{children}</main>
    </div>
  );
}
