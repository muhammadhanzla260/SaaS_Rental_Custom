import { AuthSplit, HeroSub, HeroTitle } from '@/components/auth/split';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return (
    <AuthSplit hero={<><HeroTitle>New password, same workspace.</HeroTitle><HeroSub>Choose a password with at least 8 characters.</HeroSub></>}>
      <ResetForm token={token ?? null} invalid={!!error || !token} />
    </AuthSplit>
  );
}
