import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-[max(1rem,env(safe-area-inset-left))] py-10">
      <Link href="/" className="font-display text-lg font-bold">Rental Custom</Link>
      <div className="mt-8 w-full max-w-md rounded-ui border border-line bg-surface p-6 sm:p-8">{children}</div>
    </main>
  );
}
