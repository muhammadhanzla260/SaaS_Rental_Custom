import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { PASSWORD_MIN } from '@rental/core';
import { schema } from '@rental/db';
import { db } from './db';
import { platformEmail, sendPlatformEmail } from './mailer';

export const auth = betterAuth({
  appName: 'Tentpole',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    autoSignIn: true,
    // Verification is sent, but does not block the first session (design: "sends a verification email, then lands in onboarding").
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const mail = platformEmail({
        title: 'Reset your password',
        lines: [`Hi ${user.name.split(' ')[0]}, someone asked to reset the password for ${user.email}.`, 'If it was not you, ignore this email.'],
        cta: { label: 'Choose a new password', url },
      });
      await sendPlatformEmail({ to: user.email, subject: 'Reset your Tentpole password', ...mail });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const mail = platformEmail({
        title: 'Confirm your email',
        lines: [`Hi ${user.name.split(' ')[0]}, confirm ${user.email} so your workspace can send invitations and reset passwords.`],
        cta: { label: 'Confirm email', url },
      });
      await sendPlatformEmail({ to: user.email, subject: 'Confirm your email for Tentpole', ...mail });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  plugins: [
    magicLink({
      // Only existing logins: accounts are created by registering or by an invitation.
      disableSignUp: true,
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        const mail = platformEmail({
          title: 'Your sign-in link',
          lines: ['Use this link to sign in to Tentpole. It works once and expires in 15 minutes.', 'If you did not ask for it, ignore this email.'],
          cta: { label: 'Sign in', url },
        });
        await sendPlatformEmail({ to: email, subject: 'Sign in to Tentpole', ...mail });
      },
    }),
    nextCookies(),
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;
