'use client';

import { Button, Modal } from '@/components/kit';

export function OverpaidModal({ open, amountLabel, onChoose, canRefund }: { open: boolean; amountLabel: string; onChoose: (c: 'refund' | 'wallet' | 'keep') => void; canRefund: boolean }) {
  return (
    <Modal open={open} onClose={() => onChoose('keep')} title={`The customer has paid ${amountLabel} more than the new total`} sub="What should happen to the difference?">
      <div className="flex flex-col gap-2">
        <Button variant="secondary" disabled={!canRefund} onClick={() => onChoose('wallet')} className="h-auto justify-start py-3 text-left">Move it to their wallet credit (used on a later order)</Button>
        <Button variant="secondary" disabled={!canRefund} onClick={() => onChoose('refund')} className="h-auto justify-start py-3 text-left">Refund the difference (record it as owed back)</Button>
        <Button variant="ghost" onClick={() => onChoose('keep')} className="h-auto justify-start py-3 text-left">Keep it as an overpayment for now</Button>
        {!canRefund && <p className="text-[13px] text-fg-2">Your role cannot refund or issue credit; a manager can sort it out later.</p>}
      </div>
    </Modal>
  );
}
