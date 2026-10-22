import { redirect } from 'next/navigation';

export default async function SettingsIndex({ params }: { params: Promise<{ tenant: string }> }) {
  redirect(`/${(await params).tenant}/settings/general`);
}
