import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarCheck, FileText, Package, Wallet } from 'lucide-react';
import { listUserTenants } from '@rental/db';
import { getSession } from '@/server/context';
import { db } from '@/server/db';

export default async function Home() {
  const session = await getSession();
  if (session) {
    const orgs = await listUserTenants(db, session.user.id);
    redirect(orgs.length === 1 ? `/${orgs[0]!.slug}` : orgs.length ? '/orgs' : '/onboarding');
  }
  const features = [
    { icon: CalendarCheck, title: 'Bookings without double-booking', text: 'Every item is blocked for the event and its turnaround time.' },
    { icon: FileText, title: 'Quotes customers can sign', text: 'Send a quote, collect the signature and the deposit in one link.' },
    { icon: Wallet, title: 'Deposits, invoices, receipts', text: 'Deposit on booking, balance on event day, receipts by email.' },
    { icon: Package, title: 'Inventory by warehouse', text: 'Know what ships from where, and what it costs to get there.' },
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-[max(1rem,env(safe-area-inset-left))] py-10 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <span className="font-display text-lg font-bold">Rental Custom</span>
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className="rounded-ui-sm px-3 py-2 text-[15px] font-medium hover:bg-surface-2">Sign in</Link>
          <Link href="/sign-up" className="rounded-ui-sm bg-brand px-4 py-2 text-[15px] font-medium text-brand-fg hover:bg-brand-strong">Start free</Link>
        </nav>
      </header>
      <section className="mt-16 max-w-3xl sm:mt-24">
        <h1 className="text-4xl font-bold leading-[1.05] sm:text-6xl">Run your party and event rental business from one place.</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Built for bounce houses, movie screens, tents and everything in between. Set up your business, brand and warehouses in a few minutes.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-up" className="rounded-ui-sm bg-brand px-5 py-3 font-medium text-brand-fg hover:bg-brand-strong">Create your organization</Link>
          <Link href="/sign-in" className="rounded-ui-sm border border-line-strong bg-surface px-5 py-3 font-medium hover:bg-surface-2">I already have an account</Link>
        </div>
      </section>
      <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="flex gap-4 rounded-ui border border-line bg-surface p-5">
            <f.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-text" />
            <div>
              <h2 className="text-[17px] font-semibold">{f.title}</h2>
              <p className="mt-1 text-muted">{f.text}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
