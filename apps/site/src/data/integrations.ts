/** Integrations directory (S2). Status flips from 'Coming' to 'Live' as each one ships. */
export type Integration = { name: string; cat: string; text: string; status: 'Live' | 'Coming'; vertical: 'Both' | 'Events' | 'Cars'; color: string; long: string };

const i = (name: string, cat: string, text: string, status: Integration['status'], vertical: Integration['vertical'], color: string, long: string): Integration => ({ name, cat, text, status, vertical, color, long });

export const INTEGRATIONS: Integration[] = [
  i('Stripe', 'Payments', 'Card deposits, saved cards and event-day balances, paid into your own Stripe account.', 'Live', 'Both', '#635BFF', 'Connect your Stripe account and every deposit, balance and refund runs through it. Money lands in your bank on Stripe’s normal schedule; card numbers never touch Rent Hatch.'),
  i('Google Workspace', 'Email', 'Send quotes, receipts and reminders from your own Gmail address.', 'Live', 'Both', '#1A73E8', 'Use an app password or SMTP relay so every email comes from your own address and lands in Sent.'),
  i('Microsoft 365', 'Email', 'Send from your Outlook or Exchange address.', 'Live', 'Both', '#0F6CBD', 'Connect with SMTP so customers see your company address on every message.'),
  i('Zoho Mail', 'Email', 'Send from your Zoho business address.', 'Live', 'Both', '#E42527', 'Use Zoho SMTP settings; we test the connection step by step before saving.'),
  i('Any SMTP server', 'Email', 'Mailgun, SendGrid or your host’s mail server.', 'Live', 'Both', '#353C48', 'Any server that speaks SMTP works. Each location can use its own account.'),
  i('SMS provider', 'Messaging', 'Reminders and heads-up texts from your own number.', 'Live', 'Both', '#0E7490', 'Connect a Twilio-compatible account and choose the sending number. Quiet hours apply automatically.'),
  i('Mapbox', 'Maps', 'Driving distance for travel fees and live crew maps.', 'Live', 'Events', '#4264FB', 'Built in. Distances come from your nearest warehouse; crews show on the live map while en route.'),
  i('CSV import & export', 'Data', 'Bring products and customers in; take everything out.', 'Live', 'Both', '#0B7A55', 'Download a template, fill it in and import. Export orders, payments and customers any time.'),
  i('QuickBooks Online', 'Accounting', 'Sync invoices and payments to your books.', 'Coming', 'Both', '#2CA01C', 'Planned: invoices, payments and refunds synced daily with the right income accounts.'),
  i('Xero', 'Accounting', 'Sync invoices and payments to Xero.', 'Coming', 'Both', '#0E7EA8', 'Planned alongside QuickBooks.'),
  i('Google Calendar', 'Calendar', 'See bookings and crew jobs in your calendar.', 'Coming', 'Both', '#188038', 'Planned: one calendar per location or per crew member.'),
  i('Zapier', 'Automation', 'Connect Rent Hatch to thousands of apps.', 'Coming', 'Both', '#D93F00', 'Planned triggers: new lead, order booked, payment received.'),
  i('API & webhooks', 'Developers', 'Build your own connections.', 'Coming', 'Both', '#0B0D12', 'Planned for the Scale plan: REST API and signed webhooks.'),
  i('Telematics & GPS trackers', 'Cars', 'Mileage and location from vehicle trackers.', 'Coming', 'Cars', '#6D3FD6', 'Planned for car rental after launch; early-access members choose which providers come first.'),
];
