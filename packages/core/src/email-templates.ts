/**
 * Default HTML for the customer emails, in the FreedomFun Odoo layout: brand
 * header band, hero, order blocks ({block.…}), footer with the business details.
 * Staff edit this HTML per workspace (Settings → Email & SMS → Templates);
 * Restore default brings these back.
 *
 * `extras` lets a workspace's seed add its own sections (Freedom Fun's owners'
 * note, SIOTO callout, rescheduling policy) without forking the layout.
 */
import type { MessageType } from './messaging';

export type EmailExtras = {
  /** After the hero (e.g. a trust / safety callout). */
  afterHero?: string;
  /** Before the footer (e.g. an owners' note, why us, rescheduling policy). */
  beforeFooter?: string;
  /** Pre-event reminder only: after the arrival plan. */
  preEvent?: string;
  /** Header line: '{org.name}' by default; '{org.location_name}' for "Freedom FUN USA - Austin". */
  orgLine?: string;
  /** A thin accent rule under the header band (Freedom Fun's yellow). */
  headerRule?: string;
};

const INK = '#1a1a2e';

/** The layout every template shares. */
export function emailShell(opts: { title: string; headerSub: string; body: string; footerNote?: string; extras?: EmailExtras }) {
  const x = opts.extras ?? {};
  const rule = x.headerRule ? `border-bottom:3px solid ${x.headerRule};` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${opts.title}</title>
<style>
  @media only screen and (max-width: 540px) {
    .stack-col { display: block !important; width: 100% !important; border-right: 0 !important; padding-right: 0 !important; box-sizing: border-box; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f0;font-family:Arial,Helvetica,sans-serif;color:#333;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f3f0;padding:16px 8px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e6e6;">

  <!-- Header -->
  <tr>
    <td style="background:{brand.color};padding:16px 20px;${rule}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
        <tr>
          <td style="width:56px;vertical-align:middle;">{block.logo}</td>
          <td style="vertical-align:middle;padding-left:10px;">
            <div style="font-size:17px;font-weight:700;color:{brand.on_color};line-height:1.2;">${x.orgLine ?? '{org.name}'}</div>
            <div style="font-size:12px;color:{brand.on_color};opacity:0.85;margin-top:4px;line-height:1.3;">${opts.headerSub}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
${opts.body}
${x.beforeFooter ?? ''}
  <!-- Need anything else -->
  <tr>
    <td style="padding:18px 22px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fff8e6;border:1px solid #f1dfa6;border-radius:12px;">
        <tr><td align="center" style="padding:20px 18px;">
          <div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 8px;">Need anything else for your event?</div>
          <div style="font-size:13px;line-height:1.55;color:#555;margin:0 0 14px;">Add more rentals, games or concessions before event day, subject to availability.</div>
          <a href="{org.website_url}" style="display:inline-block;background:{brand.color};color:{brand.on_color};text-decoration:none;font-size:14px;font-weight:700;padding:11px 20px;border-radius:8px;">Explore More Event Options</a>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td data-legal-footer="1" align="center" style="background:{brand.color};padding:22px 20px;color:{brand.on_color};font-size:12px;line-height:1.7;">
      <div>{org.address}</div>
      <div>{org.phone} &middot; <a href="mailto:{org.email}" style="color:{brand.on_color};text-decoration:underline;">{org.email}</a></div>
      <div><a href="{org.website_url}" style="color:{brand.on_color};text-decoration:underline;">{org.website}</a></div>
      ${opts.footerNote ? `<div style="font-size:11px;opacity:0.8;margin-top:10px;">${opts.footerNote}</div>` : ''}
      <div style="font-size:11px;opacity:0.8;margin-top:6px;">You receive this because you booked with {org.name}. Reply to this email with any questions.</div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const hero = (title: string, sub: string, align: 'left' | 'center' = 'left', pill?: string) => `
  <!-- Hero -->
  <tr>
    <td style="padding:28px 22px 10px;text-align:${align};">
      ${pill ? `<span style="display:inline-block;background:#fff4cc;color:#7a5b00;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin:0 0 14px;">${pill}</span>` : ''}
      <div style="font-size:24px;line-height:1.3;font-weight:800;color:${INK};margin:0 0 10px;">${title}</div>
      <div style="font-size:15px;line-height:1.55;color:#666;margin:0;">${sub}</div>
    </td>
  </tr>`;

const blocks = (...keys: string[]) => keys.map((k) => `  {block.${k}}`).join('\n');

const notReserved = `
  <!-- Not a reservation -->
  <tr>
    <td style="padding:8px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fff8e6;border:1px solid #f1dfa6;border-radius:10px;">
        <tr><td align="center" style="padding:14px 16px;">
          <div style="font-size:15px;font-weight:800;color:#5c4400;margin:0 0 4px;">This is a quote, not a reservation.</div>
          <div style="font-size:13px;color:#7a5b00;line-height:1.5;">Your date is not held until you complete the order. Popular dates, especially weekends, can fill quickly.</div>
        </td></tr>
      </table>
    </td>
  </tr>`;

const preEventSections = `
  <!-- Pre-event call -->
  <tr>
    <td style="padding:10px 22px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f2f8fc;border:1px solid #d7e6f0;border-radius:10px;">
        <tr><td style="padding:16px;">
          <div style="font-size:15px;font-weight:800;color:{brand.color};margin:0 0 8px;">Your pre-event call</div>
          <div style="font-size:14px;line-height:1.6;color:#444;">Our team will contact you before the event to confirm access, timing and final details. If you have not heard from us by the day before your event, call or text <strong>{org.phone}</strong>.</div>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- Prepare the event area -->
  <tr>
    <td style="padding:16px 22px 4px;">
      <div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 10px;">Prepare the event area</div>
      <div style="padding:12px 0;border-bottom:1px solid #eef0f3;"><div style="font-size:14px;font-weight:800;color:{brand.color};margin:0 0 4px;">1. Clear the setup space</div><div style="font-size:13px;line-height:1.55;color:#555;">Remove rocks, sticks, sharp objects, pet waste and other hazards. Equipment cannot be placed on muddy, wet, rocky or unsafe ground.</div></div>
      <div style="padding:12px 0;border-bottom:1px solid #eef0f3;"><div style="font-size:14px;font-weight:800;color:{brand.color};margin:0 0 4px;">2. Confirm an adult will be present</div><div style="font-size:13px;line-height:1.55;color:#555;">Someone age 18 or older must be available at arrival for access, orientation and any remaining approvals.</div></div>
      <div style="padding:12px 0;"><div style="font-size:14px;font-weight:800;color:{brand.color};margin:0 0 4px;">3. Confirm access and parking</div><div style="font-size:13px;line-height:1.55;color:#555;">Make sure our team can reach the setup area and let us know about gates, stairs, restricted parking or special entry instructions.</div></div>
    </td>
  </tr>

  <!-- Power -->
  <tr>
    <td style="padding:10px 22px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fff8e6;border:1px solid #f1dfa6;border-radius:10px;">
        <tr><td style="padding:16px;">
          <div style="font-size:15px;font-weight:800;color:#5c4400;margin:0 0 8px;">Power required for this order</div>
          <div style="font-size:14px;line-height:1.6;color:#7a5b00;">Confirm a working, grounded 110V outlet within 50 feet of the setup area. Test the circuit with a high-wattage appliance. If reliable power is unavailable, contact us now to reserve a generator, subject to availability.</div>
        </td></tr>
      </table>
    </td>
  </tr>`;

type Built = { subject: string; html: string };

/**
 * The default subject and HTML for each email the Odoo build styled.
 * Types not listed here use the simple builder layout.
 */
export function defaultEmailHtml(type: MessageType, extras: EmailExtras = {}): Built | null {
  const org = extras.orgLine ?? '{org.name}';
  const shell = (title: string, headerSub: string, body: string, footerNote?: string) => emailShell({ title, headerSub, body, footerNote, extras });
  switch (type) {
    case 'quote':
      return {
        subject: `${org} - Quote #{order.number}`,
        html: shell('Quote #{order.number}', 'Quote #{order.number}{order.prepared_suffix}', [
          hero('Prepared with care for {customer.first_name}.', 'Your event details and pricing are ready to review. Complete your order to secure your date.', 'center', 'Quote ready'),
          extras.afterHero ?? '',
          notReserved,
          blocks('payment_options', 'customer_event', 'customer_notes', 'equipment', 'pricing'),
        ].join('\n')),
      };
    case 'invoice':
      return {
        subject: `${org} - Invoice #{invoice.number} - Order #{order.number}`,
        html: shell('Invoice #{invoice.number}', 'Invoice #{invoice.number} for Order #{order.number}', [
          hero('Hi {customer.first_name}, your event is booked.', 'Please review your event details and complete your rental contract.'),
          extras.afterHero ?? '',
          blocks('payment_options', 'order_event', 'contact_card', 'customer_notes', 'equipment', 'pricing'),
        ].join('\n'), 'Invoice #{invoice.number}'),
      };
    case 'payment_partial':
      return {
        subject: `${org} - Payment Confirmation (Partial) - Order #{order.number}`,
        html: shell('Payment Confirmation - Order #{order.number}', 'Payment Confirmation · Partial payment', [
          hero('Thank you, {customer.first_name}. Your payment was received.', 'Your event is booked. Please review the summary below and complete any remaining requirements before your event date.'),
          extras.afterHero ?? '',
          blocks('payment_summary', 'contract_payment', 'order_event', 'contact_card', 'customer_notes', 'equipment', 'pricing'),
        ].join('\n'), 'Receipt #{payment.number}'),
      };
    case 'payment_paid':
      return {
        subject: `${org} - Payment Confirmation (Paid in Full) - Order #{order.number}`,
        html: shell('Payment Confirmation - Order #{order.number}', 'Payment Confirmation · Paid in full', [
          hero('Thank you, {customer.first_name}. You’re paid in full.', 'Your event is booked and nothing is left to pay. Please review the summary below before your event date.'),
          extras.afterHero ?? '',
          blocks('payment_summary', 'contract_payment', 'order_event', 'contact_card', 'customer_notes', 'equipment', 'pricing'),
        ].join('\n'), 'Receipt #{payment.number}'),
      };
    case 'charge_balance':
      return {
        subject: `${org} - Payment Confirmation (Paid in Full) - Order #{order.number}`,
        html: shell('Payment Confirmation - Order #{order.number}', 'Payment Confirmation · Balance charged', [
          hero('Today’s the day, {customer.first_name}!', 'We charged the remaining balance to your card ending {card.last4}. You’re paid in full and all set for your event.'),
          blocks('payment_summary', 'order_event', 'contact_card', 'equipment', 'pricing'),
        ].join('\n'), 'Receipt #{payment.number}'),
      };
    case 'booking_confirmation':
      return {
        subject: `${org} - Booking Confirmation - Order #{order.number}`,
        html: shell('Booking Confirmation - Order #{order.number}', 'Booking Confirmation for Order #{order.number}', [
          hero('You’re booked, {customer.first_name}!', 'Your date is reserved. Please review the details below and complete your rental contract and payment before your event.'),
          extras.afterHero ?? '',
          blocks('payment_options', 'order_event', 'contact_card', 'customer_notes', 'equipment', 'pricing'),
        ].join('\n')),
      };
    case 'pre_event':
      return {
        subject: '{event.days_to_go} to go — #{order.number}',
        html: shell('{event.days_to_go} to go — #{order.number}', 'Event reminder for Order #{order.number}', [
          hero('Your event is almost here.', 'Hi {customer.first_name}, please review the details below and complete any remaining items so our team can deliver a smooth, stress-free event.', 'center', '{event.days_to_go} to go'),
          blocks('event_card', 'checklist'),
          preEventSections,
          blocks('arrival_plan'),
          extras.preEvent ?? '',
        ].join('\n')),
      };
    case 'day_before':
      return {
        subject: 'Your event is tomorrow! — #{order.number}',
        html: shell('Your event is tomorrow! — #{order.number}', 'Event reminder for Order #{order.number}', [
          hero('Your event day is tomorrow!', 'Hi {customer.first_name}, {org.name} is excited to be part of your day. Expect a call from our operations team to confirm your arrival window. If you have not been contacted, please call or text {org.phone}.', 'center', 'Tomorrow'),
          blocks('event_card', 'checklist', 'arrival_plan', 'equipment'),
        ].join('\n')),
      };
    default:
      return null;
  }
}

export const HTML_TEMPLATE_TYPES: MessageType[] = ['quote', 'invoice', 'payment_partial', 'payment_paid', 'charge_balance', 'booking_confirmation', 'pre_event', 'day_before'];
