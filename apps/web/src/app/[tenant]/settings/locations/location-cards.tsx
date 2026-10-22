'use client';

import Link from 'next/link';
import { Clock4, MapPin, Phone, Receipt } from 'lucide-react';
import { motion } from 'motion/react';
import { Stagger, StaggerItem } from '@/components/motion';
import { StaticMap } from '@/components/static-map';
import { Badge } from '@/components/ui';

type Loc = {
  id: string; href: string; name: string; code: string; address: string; phone: string; timezone: string; tax: number;
  lat: number | null; lng: number | null; isPrimary: boolean; isActive: boolean;
};

export function LocationCards({ locations }: { locations: Loc[] }) {
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2" gap={0.07}>
      {locations.map((l) => (
        <StaggerItem key={l.id}>
          <motion.div whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }} className="h-full">
            <Link href={l.href} className="flex h-full flex-col overflow-hidden rounded-[calc(var(--radius)*1.3)] border border-line bg-surface shadow-card transition-shadow hover:shadow-pop">
              <div className="relative">
                <StaticMap lat={l.lat} lng={l.lng} width={520} height={190} className="h-[150px] w-full" label={`Map of ${l.name}`} />
                <div className="absolute left-3 top-3 flex gap-1.5">
                  {l.isPrimary && <span className="brand-gradient rounded-full px-2.5 py-0.5 text-xs font-semibold text-brand-fg shadow">Primary</span>}
                  {!l.isActive && <Badge tone="warn">Not taking bookings</Badge>}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="flex items-baseline gap-2 text-[17px] font-semibold">
                  {l.name} <span className="font-mono text-xs font-normal text-muted">{l.code}</span>
                </p>
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  <li className="flex items-center gap-2"><MapPin aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{l.address || 'No address yet'}</span>
                    {l.lat == null && <Badge tone="warn">Not on map</Badge>}
                  </li>
                  <li className="flex items-center gap-2"><Clock4 aria-hidden className="size-4 shrink-0" />{l.timezone}</li>
                  <li className="flex items-center gap-2"><Receipt aria-hidden className="size-4 shrink-0" /><span className="tabular">Sales tax {l.tax}%</span></li>
                  {l.phone && <li className="flex items-center gap-2"><Phone aria-hidden className="size-4 shrink-0" />{l.phone}</li>}
                </ul>
              </div>
            </Link>
          </motion.div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
