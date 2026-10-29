import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/app-shell';
import { CONSOLE_NAV } from '@/components/shell/nav';
import { requirePlatformAdmin } from '@/server/context';

export const metadata: Metadata = { title: { default: 'Platform console', template: '%s · Platform console' } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin();
  return (
    <AppShell
      base="/console"
      groups={CONSOLE_NAV}
      header={
        <div className="flex shrink-0 items-start gap-2.5 rounded-xl border border-[#5A1D22] bg-[#2A1115] p-2.5">
          <span className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center" aria-hidden="true">
            <span className="anim-halo absolute inset-0 rounded-full bg-[#FF6B6B]" />
            <span className="size-2.5 rounded-full bg-[#FF6B6B]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-[#FFB3B3]">Platform console</span>
            <span className="text-xs text-[#C9A3A6]">Super admin · every organization</span>
          </span>
        </div>
      }
      user={{ name: user.name, email: user.email, image: user.image, sub: 'Platform owner' }}
    >
      {children}
    </AppShell>
  );
}
