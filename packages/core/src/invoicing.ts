/**
 * One invoice per order (numbered like the order). Its payment schedule is the
 * deposit, then the balance on the event day.
 */

/**
 * The deposit step of a booked order's invoice. Once booked with money in, the
 * deposit is what was paid when it was booked: later edits change the balance,
 * not the deposit (paid $300 on $1,000, then $500 added → $1,200 balance).
 * Before any payment it is the order's deposit.
 */
export function depositStep(o: { totalCents: number; depositDueCents: number; bookedAt: Date | null }, pays: { amountCents: number; status: string; receivedAt: Date }[]) {
  const by = o.bookedAt ? o.bookedAt.getTime() + 5 * 60_000 : 0;
  const atBooking = pays.filter((p) => p.status === 'received' && p.receivedAt.getTime() <= by).reduce((s, p) => s + p.amountCents, 0);
  return Math.min(o.totalCents, atBooking > 0 ? atBooking : o.depositDueCents);
}
