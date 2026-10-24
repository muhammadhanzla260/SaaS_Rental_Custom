import { redirect } from 'next/navigation';
import { AuthSplit, CalendarIllustration, HeroSub, HeroTitle } from '@/components/auth/split';
import { getSession } from '@/server/context';
import { landingFor } from '@/server/landing';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string; error?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) redirect(await landingFor(session.user.id, sp.next));
  return (
    <AuthSplit
      hero={
        <>
          <HeroTitle>Run every rental from quote to cleanup.</HeroTitle>
          <HeroSub>Bookings, deposits and reminders for event rental businesses. One login for every workspace you belong to.</HeroSub>
          <CalendarIllustration />
        </>
      }
    >
      <SignInForm next={sp.next ?? null} email={sp.email ?? ''} linkError={sp.error ?? null} />
    </AuthSplit>
  );
}
