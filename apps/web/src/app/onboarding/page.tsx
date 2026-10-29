import { redirect } from 'next/navigation';
import { requireUser } from '@/server/context';
import { landingFor } from '@/server/landing';

/** Old link: onboarding now belongs to one workspace (/onboarding/<slug>). */
export default async function OnboardingIndex() {
  const user = await requireUser('/onboarding');
  redirect(await landingFor(user.id));
}
