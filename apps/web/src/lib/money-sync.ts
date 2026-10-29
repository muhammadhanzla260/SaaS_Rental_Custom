'use client';

/**
 * "Money moved" across the open tabs of this browser: after a payment, booking,
 * refund or tip, every other open page of the workspace refreshes its numbers.
 * Same-tab screens reload on their own; other people's screens catch up on focus.
 */
const CHANNEL = 'tentpole-money';

export function announceMoney(slug: string, orderId: string | null) {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ slug, orderId, at: Date.now() });
    bc.close();
  } catch {
    // BroadcastChannel is missing in very old browsers: the focus refresh still covers them.
  }
}

export function onMoney(slug: string, run: (orderId: string | null) => void) {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e: MessageEvent<{ slug: string; orderId: string | null }>) => { if (e.data?.slug === slug) run(e.data.orderId); };
    return () => bc.close();
  } catch {
    return () => {};
  }
}
