import { ROLE_LABELS } from '@rental/core';
import { Avatar, Card } from '@/components/kit';
import { getTenantContext } from '@/server/context';
import { AccountActions } from './account-actions';

export const metadata = { title: 'Account' };

export default async function CoachAccountPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const rows: [string, string | null | undefined][] = [
    ['Email', ctx.user.email],
    ['Company', ctx.tenant.name],
    ['Role', ROLE_LABELS[ctx.role].label],
    ['Vehicle', ctx.membership?.vehicle],
    ['Title', ctx.membership?.title],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-4 p-4">
        <Avatar name={ctx.user.name} src={ctx.user.image} size={56} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold text-fg">{ctx.user.name}</h1>
          <p className="truncate text-[13px] text-fg-2">{ctx.user.email}</p>
        </div>
      </Card>
      <Card className="divide-y divide-subtle">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 px-4 py-3 text-sm"><span className="text-fg-3">{k}</span><span className="text-right font-medium text-fg">{v}</span></div>
        ))}
      </Card>
      <p className="px-1 text-[12px] text-fg-3">Your name, vehicle and title are set by your manager in Team settings.</p>
      <AccountActions />
    </div>
  );
}
