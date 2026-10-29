/**
 * Freedom Fun USA's customer emails, as in their Odoo build
 * (custom_rental/models/sale_order_payment_email.py, sale_order.py): the shared
 * layout plus their own sections — SIOTO / insurance callout, the owners' note,
 * "Why customers choose Freedom Fun USA" and the free-rescheduling policy.
 * Saved as the demo workspace's templates; staff can edit them like any other.
 */
import { defaultEmailHtml, HTML_TEMPLATE_TYPES, templateSchema, type EmailExtras, type MessageType, type TemplateInput } from '@rental/core';

const POLICY_URL = 'https://www.freedomfunusa.com/cancellation-policy';
const INK = '#1a1a2e';

const trust = `
  <!-- Trust / SIOTO callout -->
  <tr>
    <td style="padding:8px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fdf3f3;border-left:4px solid #c62828;border-radius:6px;">
        <tr><td style="padding:16px 16px;">
          <div style="font-size:15px;font-weight:800;color:${INK};margin:0 0 6px;">Your event is too important to leave to chance.</div>
          <div style="font-size:13px;line-height:1.55;color:#555;margin:0 0 12px;">A late arrival, unclear insurance, or an unsafe setup can turn a celebration into a stressful problem. {org.name} is fully insured and one of the few SIOTO-certified inflatable operators in Texas. Our team arrives on time, follows recognized inflatable-safety practices, and comes prepared to deliver a safe, professional event.</div>
          <span style="display:inline-block;background:#ffffff;border:1px solid #e3c6c6;color:{brand.color};font-size:11px;font-weight:700;padding:6px 10px;border-radius:8px;margin:0 4px 4px 0;">SIOTO Safety Certified</span>
          <span style="display:inline-block;background:#ffffff;border:1px solid #e3c6c6;color:{brand.color};font-size:11px;font-weight:700;padding:6px 10px;border-radius:8px;margin:0 4px 4px 0;">Fully Insured</span>
          <span style="display:inline-block;background:#ffffff;border:1px solid #e3c6c6;color:{brand.color};font-size:11px;font-weight:700;padding:6px 10px;border-radius:8px;margin:0 4px 4px 0;">On Time and Prepared</span>
        </td></tr>
      </table>
    </td>
  </tr>`;

const owners = `
  <!-- A note from your local owners -->
  <tr>
    <td style="padding:18px 22px 6px;">
      <div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 8px;">A note from your local owners</div>
      <div style="font-size:14px;line-height:1.6;color:#555;margin:0 0 10px;">We're Tim and Zack Masters, your local Freedom Fun USA owners. Our team is committed to arriving prepared, providing clean and safe equipment, and making your event easy from start to finish. We would love the opportunity to serve you.</div>
      <div style="font-size:14px;font-weight:800;color:${INK};margin:0 0 2px;">Tim &amp; Zack Masters</div>
      <div style="font-size:12px;color:#888;">Owners, {org.location_name}</div>
    </td>
  </tr>

  <!-- Why customers choose -->
  <tr>
    <td style="padding:14px 22px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#eef5fb;border-radius:10px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:15px;font-weight:800;color:${INK};margin:0 0 8px;">Why customers choose Freedom Fun USA</div>
          <div style="font-size:13px;line-height:1.8;color:#444;">
            &#10003; Clean, high-quality equipment<br/>
            &#10003; Professional setup and dependable service<br/>
            &#10003; Clear communication before your event<br/>
            &#10003; Locally owned, veteran founded, and family focused<br/>
            &#10003; Trusted for events by families, schools, churches, HOAs, and companies nationwide
          </div>
        </td></tr>
      </table>
    </td>
  </tr>`;

const rescheduling = `
  <!-- Free Rescheduling, Always -->
  <tr>
    <td style="padding:16px 22px 6px;">
      <div style="font-size:16px;font-weight:800;color:${INK};margin:0 0 8px;">Free Rescheduling, Always</div>
      <div style="font-size:14px;line-height:1.6;color:#555;margin:0 0 8px;">We understand that life happens. <strong style="color:${INK};">Change or reschedule your event</strong> for any reason, no questions asked, including weather.</div>
      <a href="${POLICY_URL}" style="color:{brand.color};font-size:13px;font-weight:600;text-decoration:underline;">Review the Rescheduling and Cancellation Policy</a>
      <div style="font-size:12px;color:#888;margin-top:8px;">Paying by check? Make checks payable to <strong>{org.location_name}</strong>.</div>
    </td>
  </tr>`;

/** Which extra sections each email carries (as in the Odoo emails). */
function extrasFor(type: MessageType): EmailExtras {
  const base: EmailExtras = { orgLine: '{org.location_name}', headerRule: '#fdcd15' };
  if (type === 'quote') return { ...base, afterHero: trust, beforeFooter: owners + rescheduling };
  if (type === 'pre_event') return { ...base, preEvent: rescheduling };
  if (type === 'invoice' || type === 'payment_partial' || type === 'booking_confirmation') return { ...base, beforeFooter: rescheduling };
  return base;
}

export function freedomFunEmailTemplates(): { type: MessageType; template: TemplateInput }[] {
  return HTML_TEMPLATE_TYPES.map((type) => {
    const built = defaultEmailHtml(type, extrasFor(type))!;
    return { type, template: templateSchema.parse({ subject: built.subject, mode: 'raw', rawKind: 'html', rawSource: built.html }) };
  });
}
