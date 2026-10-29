import 'server-only';
import { ROLE_LABELS, type Role } from '@rental/core';
import { appUrl, platformEmail, sendPlatformEmailOrLink } from './mailer';

/** Invitation email; returns the link so screens can offer "copy link" when platform email is not set up. */
export async function sendInviteEmail(opts: { email: string; name?: string | null; role: Role; token: string; orgName: string; inviter: string }) {
  const url = appUrl(`/invite/${opts.token}`);
  const first = opts.name?.split(' ')[0];
  const mail = platformEmail({
    title: `Join ${opts.orgName} on Tentpole`,
    lines: [
      `${first ? `Hi ${first}, ` : ''}${opts.inviter} invited you to ${opts.orgName} as ${ROLE_LABELS[opts.role].label}.`,
      ROLE_LABELS[opts.role].description,
      'The link works once and expires in 7 days.',
    ],
    cta: { label: 'Accept invitation', url },
  });
  const r = await sendPlatformEmailOrLink({ to: opts.email, subject: `${opts.inviter} invited you to ${opts.orgName}`, ...mail });
  return { url, delivered: r.delivered };
}
