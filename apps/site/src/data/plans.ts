/**
 * Public pricing: one line, the same on the event and car sites. No plan tiers are published;
 * detailed pricing is shared on a demo call.
 */
export const STARTING_PRICE = 20;

/** schema.org offer for SoftwareApplication. */
export function offersJsonLd() {
  return { '@type': 'AggregateOffer', lowPrice: String(STARTING_PRICE), priceCurrency: 'USD', category: 'subscription' };
}
