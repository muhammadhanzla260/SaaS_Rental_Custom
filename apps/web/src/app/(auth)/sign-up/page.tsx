import { redirect } from 'next/navigation';

/** Old link: registering a business now lives at /register. */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1])).toString();
  redirect(`/register${qs ? `?${qs}` : ''}`);
}
