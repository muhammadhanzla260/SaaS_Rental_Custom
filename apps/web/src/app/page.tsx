import { redirect } from 'next/navigation';
import { getSession } from '@/server/context';
import { landingFor } from '@/server/landing';

/** No marketing page yet: send people to sign in, or to where they belong. */
export default async function Root() {
  const session = await getSession();
  redirect(session ? await landingFor(session.user.id) : '/sign-in');
}
