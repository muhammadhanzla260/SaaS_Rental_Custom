'use client';

import { useState, useTransition } from 'react';
import { Button, Notice } from '@/components/ui';
import { acceptInviteAction } from '@/server/actions/invite';

export function AcceptButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        type="button"
        pending={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInviteAction(token);
            if (r && !r.ok) setError(r.error);
          })
        }
      >
        Accept invitation
      </Button>
    </div>
  );
}
