/**
 * Company facts used across About, Contact, Security and Legal. The owner fills the TODOs;
 * pages hide a fact while it is empty rather than print a placeholder.
 */
export const COMPANY = {
  brand: 'Rent Hatch',
  legalName: '', // TODO(owner): registered company name
  address: '', // TODO(owner): registered address
  emails: {
    hello: 'hello@renthatch.org',
    sales: 'sales@renthatch.org',
    support: 'support@renthatch.org',
    security: 'security@renthatch.org',
    privacy: 'privacy@renthatch.org',
  },
  phone: '', // TODO(owner): sales phone, if any
  supportHours: 'Monday to Friday, 8 AM – 6 PM Central',
};

/** Who processes customer data. Hosting rows reflect the stack the app is deployed on. */
export const SUBPROCESSORS: [name: string, purpose: string, where: string][] = [
  ['Vercel', 'Application hosting', 'United States'],
  ['Supabase', 'Database and backups', 'United States (Oregon)'],
  ['Railway', 'Scheduled jobs: reminders and balance charges', 'United States'],
  ['Cloudflare R2', 'File storage (logos, photos, documents) and backups', 'United States'],
  ['Stripe', 'Card payments and payouts', 'United States'],
  ['Mapbox', 'Driving distances and maps', 'United States'],
  ['Your SMS provider', 'Text messages, from your own account', 'Your choice'],
];
