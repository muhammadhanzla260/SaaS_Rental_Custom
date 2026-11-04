<?php
/**
 * Settings for form.php (website forms). Edit on the server after uploading if anything changes.
 * Requesting this file in a browser shows nothing: it only returns an array to form.php.
 */
return [
  // Every lead (demo, contact, early access, newsletter) is emailed here.
  'lead_email' => 'muhammad.hanzla@trilogiks.com',

  // Sender of every email. Create this mailbox in cPanel (Email Accounts) so mail is not marked as spam.
  'from_email' => 'hello@renthatch.org',
  'from_name' => 'Rent Hatch',

  // Optional: Cloudflare Turnstile secret (pair with PUBLIC_TURNSTILE_SITE_KEY at build time).
  'turnstile_secret' => '',

  // Optional: also POST every submission as JSON to a CRM / Zapier / Make webhook.
  'crm_webhook_url' => '',

  // Testing only: write emails as files into this folder instead of sending them.
  'outbox_dir' => getenv('RH_FORMS_OUTBOX') ?: '',
];
