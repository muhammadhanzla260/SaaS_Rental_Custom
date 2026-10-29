import { redirect } from 'next/navigation';

/** Old Phase 1 address: the catalog now lives at /products. */
export default async function CatalogRedirect({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  redirect(`/${tenant}/products`);
}
