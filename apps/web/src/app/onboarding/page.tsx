import Link from 'next/link';
import { listUserTenants } from '@rental/db';
import { ThemeToggle } from '@/components/theme';
import { requireUser } from '@/server/context';
import { db } from '@/server/db';
import { OnboardingWizard } from './wizard';

export const metadata = { title: 'Set up your organization' };

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const orgs = await listUserTenants(db, user.id);
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-[max(1rem,env(safe-area-inset-left))] py-3 sm:px-6">
          <span className="font-display font-bold">Rental Custom</span>
          <div className="flex items-center gap-1">
            {orgs.length > 0 && (
              <Link href="/orgs" className="rounded-ui-sm px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
                Back to my organizations
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <OnboardingWizard ownerName={user.name} ownerEmail={user.email} appUrl={process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'} />
    </div>
  );
}
