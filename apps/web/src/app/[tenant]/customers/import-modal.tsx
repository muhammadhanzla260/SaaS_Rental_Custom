'use client';

import { useRouter } from 'next/navigation';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, Notice, useToast } from '@/components/kit';
import { importCustomersAction } from '@/server/actions/commerce';

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// Header names people actually use, mapped to our fields.
const HEADERS: Record<string, string> = {
  'first name': 'firstName', first: 'firstName', firstname: 'firstName', 'given name': 'firstName',
  'last name': 'lastName', last: 'lastName', lastname: 'lastName', surname: 'lastName', 'family name': 'lastName',
  name: 'name', 'full name': 'name', customer: 'name', 'customer name': 'name',
  company: 'companyName', organization: 'companyName', organisation: 'companyName', business: 'companyName',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  phone: 'phone', mobile: 'phone', cell: 'phone', 'phone number': 'phone', telephone: 'phone',
  'second phone': 'phoneSecondary', 'phone 2': 'phoneSecondary', 'other phone': 'phoneSecondary',
  address: 'line1', street: 'line1', 'address 1': 'line1', 'address line 1': 'line1',
  'address 2': 'line2', 'address line 2': 'line2', suite: 'line2',
  city: 'city', town: 'city', state: 'region', region: 'region', province: 'region',
  zip: 'postalCode', 'zip code': 'postalCode', postcode: 'postalCode', 'postal code': 'postalCode',
  country: 'country', notes: 'notes', note: 'notes', source: 'source', 'how heard': 'source', 'found us via': 'source',
};

export function rowsToCustomers(table: string[][], country: string) {
  const [head, ...body] = table;
  if (!head) return { mapped: [] as string[], customers: [] as Record<string, unknown>[] };
  const keys = head.map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  const customers = body.map((cells) => {
    const r: Record<string, string> = {};
    keys.forEach((k, i) => { if (k && cells[i]?.trim()) r[k] = cells[i]!.trim(); });
    if (r.name && !r.firstName && !r.lastName) {
      const parts = r.name.split(/\s+/);
      r.firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]!;
      if (parts.length > 1) r.lastName = parts[parts.length - 1]!;
    }
    return {
      kind: r.companyName && !r.firstName ? 'organization' : 'individual',
      firstName: r.firstName, lastName: r.lastName, companyName: r.companyName, email: r.email, phone: r.phone, phoneSecondary: r.phoneSecondary,
      address: { line1: r.line1, line2: r.line2, city: r.city, region: r.region, postalCode: r.postalCode, country: (r.country?.length === 2 ? r.country.toUpperCase() : country) },
      notes: r.notes, source: r.source,
    };
  });
  return { mapped: [...new Set(keys.filter(Boolean) as string[])], customers };
}

export function ImportCustomersModal({ open, onClose, slug, country }: { open: boolean; onClose: () => void; slug: string; country: string }) {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; customers: Record<string, unknown>[]; mapped: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setFile(null); setResult(null); setError(null); };
  async function pick(f: File) {
    reset();
    if (f.size > 2 * 1024 * 1024) return setError('Keep the file under 2 MB (about 10,000 rows).');
    const { mapped, customers } = rowsToCustomers(parseCsv(await f.text()), country);
    if (!customers.length) return setError('No rows found. The first row should be column names like Name, Email, Phone.');
    if (!mapped.some((m) => ['name', 'firstName', 'lastName', 'companyName'].includes(m))) return setError('Add a Name (or First name / Company) column.');
    setFile({ name: f.name, customers, mapped });
  }
  async function run() {
    if (!file) return;
    setBusy(true);
    const r = await importCustomersAction(slug, file.customers);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data!);
    toast(r.message ?? 'Imported.');
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import customers"
      sub="A CSV with a header row. Name, Email and Phone are enough; address, notes and source come along if present."
      footer={
        result ? (
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={run} pending={busy} disabled={!file}>{file ? `Import ${file.customers.length} customers` : 'Import'}</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Notice kind="success">{result.created} added. {result.skipped.length ? `${result.skipped.length} skipped.` : 'Nothing skipped.'}</Notice>
          {result.skipped.length > 0 && (
            <ul className="max-h-56 overflow-auto rounded-[var(--radius-card)] border border-subtle text-[13px]">
              {result.skipped.slice(0, 200).map((s) => (
                <li key={s.row} className="flex gap-3 border-b border-subtle px-3 py-2 last:border-0"><span className="mono text-fg-2">Row {s.row}</span><span className="text-fg">{s.reason}</span></li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="press flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-control px-4 py-8 text-center hover:bg-hover">
            <FileUp className="size-6 text-fg-2" aria-hidden />
            <span className="text-sm font-semibold text-fg">{file ? file.name : 'Choose a .csv file'}</span>
            <span className="text-[13px] text-fg-2">{file ? `${file.customers.length} rows · columns: ${file.mapped.join(', ')}` : 'Exported from Odoo, a spreadsheet or another booking tool'}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
          </label>
          {error && <Notice kind="danger">{error}</Notice>}
          <p className="text-[13px] text-fg-2">Rows with the same email or phone as an existing customer are skipped, never overwritten.</p>
        </div>
      )}
    </Modal>
  );
}
