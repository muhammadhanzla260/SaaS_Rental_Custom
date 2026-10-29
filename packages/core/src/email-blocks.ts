/**
 * The order-driven parts of the customer emails ("blocks"), modelled on the
 * FreedomFun Odoo emails (sale_order_payment_email.py): payment boxes, contract
 * & payment, event and contact cards, equipment, pricing with payment history,
 * the pre-event checklist and arrival plan.
 *
 * Templates are HTML that staff edit; a block is dropped in with a field such
 * as {block.pricing}. Blocks are generated here from plain data (EmailData), so
 * the same code renders real sends and the editor's sample preview.
 * Table-based, inline-styled: survives Gmail and Outlook.
 */
import { formatMoney } from './pricing';

// Local copy of messaging's escapeHtml (messaging imports this file).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type EmailData = {
  currency: string;
  brand: { color: string; onColor: string };
  orgName: string;
  status: 'draft' | 'quote_sent' | 'booked' | 'completed' | 'cancelled';
  orderNumber: string;
  preparedBy: string | null;
  signed: boolean;
  event: { date: string; time: string; typeLabel: string | null; street: string | null; cityLine: string | null; surface: string | null; mode: 'staffed' | 'pickup' | 'dropoff' };
  customer: { name: string; email: string | null; phone: string | null };
  contact: { name: string | null; mobile: string | null; email: string | null };
  notes: string | null;
  lines: { name: string; quantity: number; mode: 'staffed' | 'pickup' | 'dropoff'; detail: string; totalCents: number; imageUrl: string | null }[];
  /** Price rows between the items and the total (subtotal, fees, discounts, tax). */
  pricing: { label: string; cents: number; credit?: boolean }[];
  totalCents: number;
  depositCents: number;
  depositLabel: string | null;
  paidCents: number;
  payments: { label: string; cents: number }[];
  latestPayment: { cents: number; detail: string } | null;
  links: { pay: string; contract: string; quotePdf: string };
};

export const MODE_LABEL = { staffed: 'Staffed', pickup: 'Pickup', dropoff: 'Drop Off' } as const;

const INK = '#1a1a2e';
const MUTED = '#666666';
const LINE = '#dce5ec';
const GREEN = '#188038';
const RED = '#b71c1c';

const row = (inner: string, pad = '8px 22px') => `<tr><td style="padding:${pad};">${inner}</td></tr>`;
const table = (inner: string, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;${style}">${inner}</table>`;
const eyebrow = (text: string, color: string) =>
  `<div style="font-size:10px;font-weight:800;letter-spacing:0.7px;color:${color};text-transform:uppercase;margin:0 0 8px;">${text}</div>`;
const button = (label: string, href: string, d: EmailData) =>
  `<a href="${esc(href)}" style="display:block;text-align:center;background:${d.brand.color};color:${d.brand.onColor};text-decoration:none;font-size:16px;font-weight:700;padding:15px 18px;border-radius:10px;">${label}</a>`;
const link = (label: string, href: string, d: EmailData) =>
  `<a href="${esc(href)}" style="color:${d.brand.color};font-size:13px;font-weight:600;text-decoration:underline;">${label}</a>`;

const dueOf = (d: EmailData) => Math.max(0, d.totalCents - d.paidCents);
const isQuote = (d: EmailData) => d.status === 'draft' || d.status === 'quote_sent';

/** Logo for the header band: the workspace logo, else its initials. */
function logo(d: EmailData, logoUrl: string | null) {
  if (logoUrl) return `<img src="${esc(logoUrl)}" alt="${esc(d.orgName)}" width="48" style="display:block;width:48px;max-width:48px;height:auto;border-radius:8px;"/>`;
  const initials = d.orgName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div style="width:48px;height:48px;border-radius:10px;background:rgba(255,255,255,.18);color:${d.brand.onColor};font:700 17px/48px Arial,sans-serif;text-align:center;">${esc(initials)}</div>`;
}

/** Quote: "Choose the option that works best for you" — pay in full or the deposit. */
function paymentOptionsQuote(d: EmailData, m: (c: number) => string) {
  const dep = d.depositCents;
  const free = d.totalCents <= 0;
  const card = (badge: string, badgeBg: string, badgeFg: string, title: string, amount: string, text: string, strong: boolean) => `
<td class="stack-col" style="width:${dep > 0 ? '50%' : '100%'};vertical-align:top;padding:0 6px 12px 0;">
  ${table(`<tr><td align="center" style="padding:18px 14px;">
    <span style="display:inline-block;background:${badgeBg};color:${badgeFg};font-size:10px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${badge}</span>
    <div style="font-size:12px;font-weight:800;letter-spacing:0.6px;color:${d.brand.color};text-transform:uppercase;margin:12px 0 6px;">${title}</div>
    <div style="font-size:30px;font-weight:800;color:${INK};line-height:1.1;margin:0 0 8px;">${amount}</div>
    <div style="font-size:12px;line-height:1.45;color:${MUTED};">${text}</div>
  </td></tr>`, `border:${strong ? `2px solid ${d.brand.color}` : `1px solid ${LINE}`};border-radius:12px;background:#ffffff;`)}
</td>`;
  const full = card(free ? 'No payment due' : 'Easiest option', d.brand.color, d.brand.onColor, free ? 'Quote total' : 'Pay in full', m(d.totalCents),
    free ? 'This booking is fully discounted. Complete your order to confirm the date.' : 'Pay once now. Then relax knowing your event balance is taken care of.', true);
  const deposit = dep > 0
    ? card('Minimum payment', '#e9edf1', '#45505c', `Pay ${esc(d.depositLabel ?? 'deposit')} deposit`, m(dep), 'Pay the minimum required today and the remaining balance later.', false)
    : '';
  return row(table(`<tr><td style="padding:20px 16px 18px;">
  <div style="font-size:17px;font-weight:800;color:${INK};text-align:center;margin:0 0 14px;">${free ? `No payment is due — your quote total is ${m(0)}.` : 'Choose the option that works best for you'}</div>
  ${table(`<tr>${full}${deposit}</tr>`)}
  ${button('Complete My Order', d.links.pay, d)}
  <div style="font-size:12px;color:${MUTED};text-align:center;line-height:1.5;margin-top:12px;">${dep > 0 ? `Review and accept the rental terms, then pay in full or choose the ${esc(d.depositLabel ?? '')} deposit.` : 'Review and accept the rental terms to confirm your booking.'}</div>
  <div style="text-align:center;margin-top:10px;">${link('Download Quote (PDF)', d.links.quotePdf, d)}</div>
</td></tr>`, `background:#f5f9fc;border:1px solid ${LINE};border-radius:12px;`));
}

/** Invoice: "Payment options" with what is due now (remaining balance, or full / deposit). */
function paymentOptionsInvoice(d: EmailData, m: (c: number) => string) {
  const due = dueOf(d);
  if (due <= 0) {
    return row(table(`<tr><td style="padding:18px;text-align:center;">
  ${eyebrow('Payment status', d.brand.color)}
  <div style="font-size:24px;font-weight:800;color:${GREEN};">Paid in full</div>
  <div style="font-size:13px;color:${MUTED};margin-top:6px;">Thank you! Nothing is left to pay on this order.</div>
</td></tr>`, `background:#eefaf1;border:1px solid #cfe9d6;border-radius:12px;`));
  }
  const paid = d.paidCents > 0;
  const showDeposit = !paid && d.depositCents > 0 && d.depositCents < due;
  const box = (badge: string, title: string, amount: string, text: string, strong: boolean) => `
<td class="stack-col" style="width:${showDeposit ? '50%' : '100%'};vertical-align:top;padding:0 ${showDeposit ? '6px 12px 0' : '0 12px 0'};">
  ${table(`<tr><td align="center" style="padding:22px 14px;">
    <span style="display:inline-block;background:${d.brand.color};color:${d.brand.onColor};font-size:10px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${badge}</span>
    <div style="font-size:12px;font-weight:800;letter-spacing:0.6px;color:${d.brand.color};text-transform:uppercase;margin:12px 0 6px;">${title}</div>
    <div style="font-size:30px;font-weight:800;color:${INK};line-height:1.1;margin:0 0 8px;">${amount}</div>
    <div style="font-size:12px;line-height:1.45;color:${MUTED};">${text}</div>
  </td></tr>`, `border:${strong ? `2px solid ${d.brand.color}` : `1px solid ${LINE}`};border-radius:12px;background:#ffffff;`)}
</td>`;
  const first = paid
    ? box('Remaining balance', 'Pay remaining balance', m(due), 'Complete your remaining balance now.', true)
    : box('Easiest option', 'Pay in full', m(due), 'Pay once now. Then relax knowing your event balance is taken care of.', true);
  const second = showDeposit ? box('Minimum payment', `Pay ${esc(d.depositLabel ?? 'deposit')} deposit`, m(d.depositCents), 'Pay the minimum required today and the remaining balance later.', false) : '';
  const cta = paid
    ? (d.signed ? 'Pay Remaining Balance' : 'Review Contract &amp; Pay Remaining Balance')
    : (d.signed ? 'Continue to Payment' : 'Review Contract &amp; Continue to Payment');
  return row(table(`<tr><td style="padding:18px 16px;">
  ${table(`<tr><td style="vertical-align:top;">
    ${eyebrow('Payment options', d.brand.color)}
    <div style="font-size:12px;color:${MUTED};">Order total ${m(d.totalCents)} · ${paid ? `${m(d.paidCents)} payment recorded` : 'No payment recorded'}</div>
  </td><td align="right" style="vertical-align:top;font-size:22px;font-weight:800;color:${INK};white-space:nowrap;">${m(due)} due</td></tr>`)}
  <div style="height:14px;line-height:14px;">&nbsp;</div>
  ${table(`<tr>${first}${second}</tr>`)}
  ${button(cta, d.links.pay, d)}
  <div style="text-align:center;margin-top:12px;">${link('Download Contract (PDF)', d.links.contract, d)}</div>
  <div style="font-size:12px;color:${MUTED};text-align:center;line-height:1.5;margin-top:8px;">Make checks payable to ${esc(d.orgName)}.</div>
</td></tr>`, `background:#f5f9fc;border:1px solid ${LINE};border-radius:12px;`));
}

/** Payment confirmation: payment received · remaining balance · order. */
function paymentSummary(d: EmailData, m: (c: number) => string) {
  const due = dueOf(d);
  const latest = d.latestPayment ?? { cents: d.paidCents, detail: 'Payment received' };
  const cell = (title: string, value: string, color: string, sub: string, last = false, size = 22) =>
    `<td class="stack-col" style="width:33.33%;vertical-align:top;padding:16px 14px;${last ? '' : `border-right:1px solid ${LINE};`}">${eyebrow(title, d.brand.color)}
<div style="font-size:${size}px;font-weight:800;color:${color};line-height:1.15;margin:0 0 6px;white-space:nowrap;">${value}</div>${sub}</td>`;
  return row(table(`<tr>
${cell('Payment received', m(latest.cents), GREEN, `<div style="font-size:12px;line-height:1.45;color:${MUTED};">${esc(latest.detail)}</div>`)}
${cell('Remaining balance', m(due), due > 0 ? RED : GREEN, `<div style="font-size:12px;line-height:1.45;color:${MUTED};">${due > 0 ? 'Due in full before the event!' : 'Paid in full — thank you!'}</div>`)}
${cell('Order', `#${esc(d.orderNumber)}`, INK, `<div style="font-size:12px;font-weight:700;color:${GREEN};">${isQuote(d) ? 'Confirmed' : 'Booked'}</div>`, true, 17)}
</tr>`, `border:1px solid #d7e0e8;border-radius:12px;background:#ffffff;`));
}

/** "Contract & Payment" call to action while money is still owed. */
function contractPayment(d: EmailData) {
  if (dueOf(d) <= 0) return '';
  return row(table(`<tr><td style="padding:20px 18px 18px;">
  <div style="font-size:16px;font-weight:800;color:${d.brand.color};margin:0 0 8px;">Contract &amp; Payment</div>
  <div style="font-size:13px;line-height:1.55;color:#444;margin:0 0 16px;">${d.signed ? 'Your rental contract is signed. Please pay the remaining balance before your event date.' : 'Your rental contract must be signed before your event begins. Please sign the contract and pay the remaining balance before your event date.'}</div>
  ${button(d.signed ? 'Make Payment' : 'Review/Sign Contract &amp; Make Payment', d.links.pay, d)}
  <div style="text-align:center;margin-top:12px;">${link('Download Contract (PDF)', d.links.contract, d)}</div>
  <div style="font-size:12px;color:${MUTED};line-height:1.5;margin-top:12px;text-align:center;">Make checks payable to ${esc(d.orgName)}.</div>
</td></tr>`, `background:#eef7fb;border:1px solid #cfe3ef;border-radius:12px;`));
}

/** Order number / prepared by · event date and time. */
function orderEvent(d: EmailData) {
  return row(table(`<tr>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;border-right:1px solid ${LINE};">${eyebrow(d.preparedBy ? 'Prepared by' : 'Order', d.brand.color)}
  <div style="font-size:16px;font-weight:800;color:${INK};line-height:1.3;">${d.preparedBy ? esc(d.preparedBy) : `#${esc(d.orderNumber)}`}</div>
  ${d.preparedBy ? `<div style="font-size:13px;color:${MUTED};margin-top:4px;">Order #${esc(d.orderNumber)}</div>` : ''}</td>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;">${eyebrow('Event', d.brand.color)}
  <div style="font-size:16px;font-weight:800;color:${INK};line-height:1.3;margin:0 0 4px;">${esc(d.event.date)}</div>
  <div style="font-size:13px;color:${MUTED};line-height:1.45;">${esc(d.event.time)}</div></td>
</tr>`, `border:1px solid #d7e0e8;border-radius:12px;background:#ffffff;`), '18px 22px 6px');
}

/** Event-day point of contact, address and setup details. */
function contactCard(d: EmailData) {
  const c = d.contact;
  const who = [c.name, c.mobile].filter(Boolean).map((x) => esc(x!)).join(' | ');
  const address = [d.event.street, d.event.cityLine].filter(Boolean).map((x) => esc(x!)).join(', ');
  const extra = [d.event.typeLabel, d.event.surface ? `Setup Surface: ${d.event.surface}` : null].filter(Boolean).map((x) => esc(x!)).join(' | ');
  const parts: string[] = [];
  if (who || c.email) {
    parts.push(`<tr><td style="padding:16px 14px;">${eyebrow('Event day point of contact', d.brand.color)}
  ${who ? `<div style="font-size:15px;font-weight:700;color:${INK};">${who}</div>` : ''}
  ${c.email ? `<div style="font-size:13px;color:#333;margin-top:4px;">${esc(c.email)}</div>` : ''}</td></tr>`);
  }
  if (address || extra) {
    parts.push(`<tr><td style="padding:16px 14px;${parts.length ? `border-top:1px solid ${LINE};` : ''}">${eyebrow('Event address', d.brand.color)}
  ${address ? `<div style="font-size:14px;color:${INK};line-height:1.45;font-weight:500;">${address}</div>` : ''}
  ${extra ? `<div style="font-size:12px;color:#888;margin-top:6px;">${extra}</div>` : ''}</td></tr>`);
  }
  return parts.length ? row(table(parts.join(''), `border:1px solid #d7e0e8;border-radius:12px;background:#ffffff;`), '10px 22px 6px') : '';
}

/** Quote: customer and event details side by side. */
function customerEvent(d: EmailData) {
  const c = d.customer;
  const address = [d.event.street, d.event.cityLine].filter(Boolean).map((x) => esc(x!)).join('<br/>');
  return row(`<div style="font-size:18px;font-weight:800;color:${INK};margin:0 0 12px;">Customer &amp; Event Details</div>
${table(`<tr>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;border-right:1px solid ${LINE};">${eyebrow('Customer', d.brand.color)}
  <div style="font-size:16px;font-weight:800;color:${INK};line-height:1.3;margin:0 0 8px;">${esc(c.name)}</div>
  ${c.email ? `<div style="font-size:14px;margin:0 0 8px;"><a href="mailto:${esc(c.email)}" style="color:${d.brand.color};text-decoration:underline;">${esc(c.email)}</a></div>` : ''}
  ${c.phone ? `<div style="font-size:13px;color:#333;"><strong style="color:${INK};">Primary Phone:</strong> ${esc(c.phone)}</div>` : ''}</td>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;">${eyebrow('Event', d.brand.color)}
  ${d.event.typeLabel ? `<div style="font-size:16px;font-weight:800;color:${INK};line-height:1.3;margin:0 0 8px;">${esc(d.event.typeLabel)}</div>` : ''}
  <div style="font-size:13px;color:#444;">${esc(d.event.date)}</div>
  <div style="font-size:13px;color:#555;margin:0 0 10px;">${esc(d.event.time)}</div>
  ${address ? `<div style="font-size:13px;color:#333;line-height:1.55;"><strong style="color:${INK};">Event Address:</strong><br/>${address}</div>` : ''}</td>
</tr>`, `border:1px solid #d7e0e8;border-radius:12px;background:#f8fbfd;`)}`, '22px 22px 8px');
}

function customerNotes(d: EmailData) {
  if (!d.notes?.trim()) return '';
  return row(table(`<tr><td style="padding:16px 14px;">${eyebrow('Customer notes', '#8a6d00')}
  <div style="font-size:14px;color:#444;line-height:1.5;">${esc(d.notes).replace(/\n/g, '<br/>')}</div></td></tr>`, `background:#fff8e6;border:1px solid #f1dfa6;border-radius:12px;`), '10px 22px 6px');
}

function equipment(d: EmailData, m: (c: number) => string) {
  if (!d.lines.length) return '';
  const rows = d.lines.map((l, i) => `<tr>
<td style="width:56px;vertical-align:top;padding:12px 10px 12px 0;${i ? `border-top:1px solid #eef0f3;` : ''}">${l.imageUrl
    ? `<img src="${esc(l.imageUrl)}" alt="" width="46" height="46" style="display:block;width:46px;height:46px;border-radius:6px;object-fit:cover;"/>`
    : `<div style="width:46px;height:46px;border-radius:6px;background:#eef3f7;"></div>`}</td>
<td style="vertical-align:top;padding:12px 8px 12px 0;${i ? `border-top:1px solid #eef0f3;` : ''}">
  <div style="font-size:15px;font-weight:800;color:${INK};">${esc(l.name)} <span style="display:inline-block;background:#222;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;vertical-align:middle;">${MODE_LABEL[l.mode]}</span></div>
  <div style="font-size:12px;color:#888;margin-top:4px;">${esc(l.detail)}</div></td>
<td style="vertical-align:top;padding:12px 8px;color:#555;font-size:13px;white-space:nowrap;${i ? `border-top:1px solid #eef0f3;` : ''}">${l.quantity}</td>
<td align="right" style="vertical-align:top;padding:12px 0;font-size:14px;font-weight:700;color:${INK};white-space:nowrap;${i ? `border-top:1px solid #eef0f3;` : ''}">${m(l.totalCents)}</td>
</tr>`).join('');
  return row(`<div style="font-size:16px;font-weight:800;color:${INK};padding-bottom:8px;border-bottom:2px solid #fdcd15;margin:0 0 4px;">Equipment &amp; Services</div>${table(rows)}`, '22px 22px 8px');
}

/** Pricing summary: price rows, total band, then deposit (quotes) or payment history and balance. */
function pricing(d: EmailData, m: (c: number) => string) {
  const line = (label: string, value: string, color = INK, bold = false) =>
    `<tr><td style="padding:7px 0;font-size:14px;color:${color};${bold ? 'font-weight:700;' : ''}">${label}</td><td align="right" style="padding:7px 0;font-size:14px;color:${color};font-weight:${bold ? 800 : 600};white-space:nowrap;">${value}</td></tr>`;
  const quote = isQuote(d) && d.paidCents <= 0;
  const due = dueOf(d);
  const rows = d.pricing.map((p) => line(esc(p.label), p.credit ? `-${m(Math.abs(p.cents))}` : m(p.cents), p.credit ? '#c62828' : INK, false)).join('');
  const band = `<tr><td colspan="2" style="padding:10px 0;">${table(`<tr><td style="padding:12px 14px;font-size:15px;font-weight:800;color:${d.brand.onColor};">${quote ? 'Quote Total' : 'Grand Total'}</td><td align="right" style="padding:12px 14px;font-size:17px;font-weight:800;color:${d.brand.onColor};">${m(d.totalCents)}</td></tr>`, `background:${d.brand.color};border-radius:8px;`)}</td></tr>`;
  let after = '';
  if (quote) {
    if (d.depositCents > 0) {
      after = `<tr><td colspan="2" style="padding:6px 0;">${table(`<tr><td style="padding:12px 14px;"><div style="font-size:15px;font-weight:800;color:#8a6d00;">Deposit Due</div><div style="font-size:11px;color:#a08a40;margin-top:2px;">Required to secure your booking</div></td><td align="right" style="padding:12px 14px;font-size:17px;font-weight:800;color:#8a6d00;">${m(d.depositCents)}</td></tr>`, `background:#fff8e6;border:1px solid #f1dfa6;border-radius:8px;`)}</td></tr>`;
    }
  } else {
    if (d.depositCents > 0) after += line(`Deposit Due${d.depositLabel ? ` (${esc(d.depositLabel)})` : ''}`, m(d.depositCents), d.brand.color, true);
    if (d.payments.length) {
      after += `<tr><td colspan="2" style="padding:12px 0 4px;font-size:12px;font-weight:800;color:${INK};">Payment History</td></tr>`;
      after += d.payments.map((p) => line(esc(p.label), `-${m(p.cents)}`, GREEN)).join('');
      after += line('Total Paid', m(d.paidCents), GREEN, true);
    }
    after += `<tr><td colspan="2" style="padding:8px 0 0;">${table(`<tr><td style="padding:12px 14px;font-size:15px;font-weight:800;color:${due > 0 ? RED : GREEN};">Balance Due</td><td align="right" style="padding:12px 14px;font-size:16px;font-weight:800;color:${due > 0 ? RED : GREEN};">${m(due)}</td></tr>`, `background:${due > 0 ? '#fdecec' : '#eaf7ee'};border-radius:8px;`)}</td></tr>`;
  }
  return row(`<div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 10px;">Pricing Summary</div>
${table(`<tr><td style="padding:12px 16px;">${table(rows + band + after)}</td></tr>`, `border:1px solid #e3e7eb;border-radius:12px;`)}`, '18px 22px 8px');
}

/** Pre-event: event and location card. */
function eventCard(d: EmailData) {
  return row(table(`<tr>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;">${eyebrow('Event', d.brand.color)}
  <div style="font-size:15px;font-weight:800;color:${INK};">${esc(d.event.typeLabel ?? 'Your Event')}</div>
  <div style="font-size:13px;color:#555;line-height:1.45;margin-top:4px;">${esc(d.event.date)}</div>
  <div style="font-size:13px;color:${MUTED};line-height:1.45;">${esc(d.event.time)}</div></td>
<td class="stack-col" style="width:50%;vertical-align:top;padding:16px 14px;">${eyebrow('Location', d.brand.color)}
  <div style="font-size:15px;font-weight:800;color:${INK};">${esc(d.event.street ?? 'Your event address')}</div>
  ${d.event.cityLine ? `<div style="font-size:13px;color:#555;line-height:1.45;margin-top:4px;">${esc(d.event.cityLine)}</div>` : ''}
  <div style="font-size:13px;color:${MUTED};line-height:1.45;">${MODE_LABEL[d.event.mode]} event</div></td>
</tr>`, `background:#f2f8fc;border:1px solid #d7e6f0;border-radius:10px;`), '14px 22px 6px');
}

/** Pre-event: what is still needed before the event (contract, balance). */
function checklist(d: EmailData, m: (c: number) => string) {
  const due = dueOf(d);
  const pill = (text: string, bg: string, fg: string) =>
    `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:800;letter-spacing:0.04em;padding:5px 10px;border-radius:999px;">${text}</span>`;
  const item = (title: string, sub: string, right: string, first = false) =>
    `<tr><td style="padding:14px 0;${first ? '' : 'border-top:1px solid #eef0f3;'}"><div style="font-size:15px;font-weight:800;color:${INK};margin:0 0 3px;">${title}</div><div style="font-size:12px;color:#777;">${sub}</div></td>
<td align="right" style="padding:14px 0;vertical-align:middle;${first ? '' : 'border-top:1px solid #eef0f3;'}">${right}</td></tr>`;
  return row(`<div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 4px;">Before event day</div>
${table(
    item('Rental contract', d.signed ? 'Signed and on file for this order.' : 'Required before your event begins.', d.signed ? pill('SIGNED', '#ecfdf3', '#067647') : pill('ACTION NEEDED', '#fff4cc', '#7a5b00'), true)
    + item('Remaining balance', due > 0 ? 'Pay online now or use an approved payment method.' : 'No remaining balance on this order.', due > 0 ? `<span style="font-size:16px;font-weight:800;color:#c62828;">${m(due)}</span>` : pill('PAID', '#ecfdf3', '#067647')),
  )}
<div style="height:14px;line-height:14px;">&nbsp;</div>
${button(d.signed ? (due > 0 ? 'Pay Remaining Balance' : 'Review Event Details') : 'Review Event Details &amp; Complete Requirements', d.links.pay, d)}`, '18px 22px 8px');
}

/** Pre-event: how the crew arrives, by service mode. */
function arrivalPlan(d: EmailData) {
  const plan = {
    staffed: ['Arrival plan: Staffed event', 'Our team generally arrives 45 to 60 minutes before the scheduled start time to prepare the equipment. This setup time does not reduce your reserved event time. Your local team will confirm the arrival window before the event.'],
    dropoff: ['Arrival plan: Drop Off event', 'Depending on the day’s schedule, our team generally arrives 1–8 hours before your event start time. Your local team will call 1–2 days before the event with an approximate arrival window. Someone age 18 or older must be present at delivery, and the person operating the equipment must be available for orientation.'],
    pickup: ['Arrival plan: Pickup event', 'Please arrive on time for your warehouse pickup window. Someone age 18 or older must be present for orientation and any remaining required approvals. Late arrivals may shorten your rental time.'],
  }[d.event.mode];
  return row(table(`<tr><td style="padding:16px 16px;"><div style="font-size:15px;font-weight:800;color:${d.brand.color};margin:0 0 8px;">${plan[0]}</div>
<div style="font-size:14px;line-height:1.6;color:#444;">${plan[1]}</div></td></tr>`, `background:#f2f8fc;border:1px solid #d7e6f0;border-radius:10px;`), '10px 22px 8px');
}

/** Every block for one message, keyed by its template field. */
export function emailBlocks(d: EmailData, logoUrl: string | null): Record<string, string> {
  const m = (c: number) => formatMoney(c, d.currency);
  return {
    'block.logo': logo(d, logoUrl),
    'block.payment_options': isQuote(d) ? paymentOptionsQuote(d, m) : paymentOptionsInvoice(d, m),
    'block.payment_summary': paymentSummary(d, m),
    'block.contract_payment': contractPayment(d),
    'block.order_event': orderEvent(d),
    'block.contact_card': contactCard(d),
    'block.customer_event': customerEvent(d),
    'block.customer_notes': customerNotes(d),
    'block.equipment': equipment(d, m),
    'block.pricing': pricing(d, m),
    'block.event_card': eventCard(d),
    'block.checklist': checklist(d, m),
    'block.arrival_plan': arrivalPlan(d),
  };
}

export const EMAIL_BLOCKS = [
  { key: 'block.logo', label: 'Logo (or initials)' },
  { key: 'block.payment_options', label: 'Payment options (quote: full or deposit · invoice: what is due)' },
  { key: 'block.payment_summary', label: 'Payment received · remaining balance · order' },
  { key: 'block.contract_payment', label: 'Contract & payment (only while money is owed)' },
  { key: 'block.order_event', label: 'Prepared by · event date' },
  { key: 'block.contact_card', label: 'Event-day contact and address' },
  { key: 'block.customer_event', label: 'Customer & event details' },
  { key: 'block.customer_notes', label: 'Customer notes (only when there are notes)' },
  { key: 'block.equipment', label: 'Equipment & services' },
  { key: 'block.pricing', label: 'Pricing summary with payment history' },
  { key: 'block.event_card', label: 'Event and location card' },
  { key: 'block.checklist', label: 'Before event day: contract and balance' },
  { key: 'block.arrival_plan', label: 'Arrival plan (staffed, drop-off or pickup)' },
] as const;
export const BLOCK_KEYS = new Set<string>(EMAIL_BLOCKS.map((b) => b.key));

/** The sample order behind every preview in the template editor. */
export function sampleEmailData(brand: { color: string; onColor: string }, orgName: string, stage: 'quote' | 'deposit' | 'paid' | 'unpaid' = 'deposit'): EmailData {
  const d: EmailData = {
    currency: 'USD', brand, orgName, status: 'booked', orderNumber: 'Q-AUS-01043', preparedBy: 'Sam Ortiz', signed: false,
    event: { date: 'Saturday, November 7, 2026', time: '1:00 PM to 6:00 PM CT', typeLabel: 'Birthday Party', street: '1890 Ranch Shopping Center', cityLine: 'Cedar Park, TX 78613', surface: 'Grass', mode: 'staffed' },
    customer: { name: 'Maria Gonzalez', email: 'maria@example.com', phone: '(512) 555-0142' },
    contact: { name: 'Maria', mobile: '(512) 555-0198', email: 'maria@example.com' },
    notes: 'Gate code 4412. Please set up near the oak tree.',
    lines: [
      { name: 'Castle Bounce House', quantity: 1, mode: 'staffed', detail: '5 hours · Sat, Nov 7 1:00 PM – 6:00 PM', totalCents: 22500, imageUrl: null },
      { name: 'Popcorn Machine', quantity: 1, mode: 'staffed', detail: '5 hours · Sat, Nov 7 1:00 PM – 6:00 PM', totalCents: 7500, imageUrl: null },
    ],
    pricing: [
      { label: 'Rental Subtotal', cents: 30000 }, { label: 'Damage Waiver (10%)', cents: 3000 }, { label: 'Travel Fee', cents: 2125 },
      { label: 'Discount (5%)', cents: -1500, credit: true }, { label: 'Tax (8.25%)', cents: 2775 },
    ],
    totalCents: 36400, depositCents: 10920, depositLabel: '30%', paidCents: 10920,
    payments: [{ label: 'Credit Card: 2026-10-02', cents: 10920 }],
    latestPayment: { cents: 10920, detail: 'Card ending in 4242 · Oct 2, 2026' },
    links: { pay: '#', contract: '#', quotePdf: '#' },
  };
  // The preview follows the email: a quote has no payments yet, "paid" has the balance in too.
  if (stage === 'quote' || stage === 'unpaid') return { ...d, status: stage === 'quote' ? 'quote_sent' : 'booked', paidCents: 0, payments: [], latestPayment: null };
  if (stage === 'paid') {
    return { ...d, signed: true, paidCents: d.totalCents, payments: [...d.payments, { label: 'Credit Card: 2026-11-07', cents: d.totalCents - 10920 }], latestPayment: { cents: d.totalCents - 10920, detail: 'Card ending in 4242 · Nov 7, 2026' } };
  }
  return d;
}
