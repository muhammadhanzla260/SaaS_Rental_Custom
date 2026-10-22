import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-muted">The page does not exist, or you are not a member of this organization.</p>
      <Link href="/" className="mt-2 rounded-ui-sm bg-brand px-4 py-2 font-medium text-brand-fg hover:bg-brand-strong">Go to my organizations</Link>
    </main>
  );
}
