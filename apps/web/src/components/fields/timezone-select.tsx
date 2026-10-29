'use client';

import { useMemo } from 'react';
import { listTimezones } from '@rental/core';
import { Select } from '@/components/kit';

export const COMMON_ZONES = [
  ['America/Chicago', 'Central'],
  ['America/New_York', 'Eastern'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'],
  ['Europe/London', 'UK'],
  ['Asia/Dubai', 'UAE'],
] as const;

export function zoneLabel(tz: string) {
  const c = COMMON_ZONES.find(([z]) => z === tz);
  return c ? `${c[1]} — ${tz}` : tz.replace(/_/g, ' ');
}

export function TimezoneSelect({ id, value, onChange, invalid }: { id?: string; value: string; onChange: (tz: string) => void; invalid?: boolean }) {
  const others = useMemo(() => listTimezones().filter((z) => !COMMON_ZONES.some(([c]) => c === z)), []);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid}>
      <optgroup label="Common">
        {COMMON_ZONES.map(([z, name]) => (
          <option key={z} value={z}>{`${name} — ${z}`}</option>
        ))}
      </optgroup>
      <optgroup label="All time zones">
        {others.map((z) => (
          <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
        ))}
      </optgroup>
    </Select>
  );
}

/** "2:40 AM" in a zone; empty for an invalid zone. */
export function localTime(tz: string, at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(at);
  } catch {
    return '';
  }
}
