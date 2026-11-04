/**
 * Event-rental plans: the single pricing config for the home page, the pricing page, the quiz and
 * structured data. Prices are whole US dollars per month. SAMPLE PRICES until the owner confirms.
 */
export const PRICES_FINAL = false;

export type PlanId = 'starter' | 'growth' | 'scale';
export type Plan = {
  id: PlanId;
  name: string;
  who: string;
  monthly: number;
  yearly: number; // per month, billed yearly (20% off)
  locations: number | null; // null = unlimited
  users: number | null;
  highlights: string[];
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: 'starter', name: 'Starter', who: 'One location getting organised', monthly: 49, yearly: 39, locations: 1, users: 3,
    highlights: ['1 location · 3 users', 'Quotes, bookings & calendar', 'E-sign & online deposits', 'Email automations', 'Core reports'],
  },
  {
    id: 'growth', name: 'Growth', who: 'Growing teams with crews on the road', monthly: 129, yearly: 103, locations: 3, users: 10, popular: true,
    highlights: ['3 locations · 10 users', 'Everything in Starter', 'SMS reminders & lead follow-ups', 'Crew portal with live GPS', 'All 32 reports · custom domain'],
  },
  {
    id: 'scale', name: 'Scale', who: 'Multi-location operations', monthly: 299, yearly: 239, locations: null, users: null,
    highlights: ['Unlimited locations & users', 'Everything in Growth', 'Data migration done for you', 'Priority support', 'API & webhooks when released'],
  },
];

export const YEARLY_DISCOUNT = 20;
export const TRIAL_DAYS = 14;
export const plan = (id: PlanId) => PLANS.find((p) => p.id === id)!;

/** The cheapest plan that covers a business (pricing estimator). */
export function planFor(locations: number, users: number): Plan {
  return PLANS.find((p) => (p.locations === null || locations <= p.locations) && (p.users === null || users <= p.users)) ?? PLANS[PLANS.length - 1]!;
}

/** Quiz rule: Starter = 1 location, no crews, under 150 bookings a month; Scale = 4+ locations or 500+ bookings; otherwise Growth. */
export function quizPlan(a: { locations: number; crews: boolean; bookings: number }): PlanId {
  if (a.locations >= 4 || a.bookings >= 500) return 'scale';
  if (a.locations <= 1 && !a.crews && a.bookings < 150) return 'starter';
  return 'growth';
}

/** schema.org offers for SoftwareApplication; only emitted once prices are final. */
export function offersJsonLd() {
  if (!PRICES_FINAL) return undefined;
  return PLANS.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.monthly), priceCurrency: 'USD', category: 'subscription' }));
}

/** Pricing page (E4) card bullets, a little longer than the home page teaser. */
export const PLAN_DETAILS: Record<PlanId, string[]> = {
  starter: ['1 location · 3 users', 'Quotes, bookings & calendar', 'E-sign & online deposits', 'Auto-charged balances', 'Email automations', '10 core reports'],
  growth: ['3 locations · 10 users', 'Everything in Starter', 'SMS reminders · 500 / mo', 'Crew portal & live GPS', 'Lead pipeline & follow-ups', 'All 32 reports · custom domain'],
  scale: ['Unlimited locations & users', 'Everything in Growth', 'SMS · 2,000 / mo', 'Data migration done for you', 'Priority support', 'API & webhooks when released'],
};
export const ENTERPRISE = { name: 'Enterprise', who: 'Franchises and national fleets', highlights: ['Everything in Scale', 'SSO & custom roles', 'Custom reports', 'Dedicated manager', 'Uptime SLA', 'Volume SMS pricing'] };

/** Estimator add-ons: what Starter pays extra for; bigger plans include them. */
export const ADDONS = { smsStarterMonthly: 15, migrationStarterOnce: 99 };

const Y = '✓', N = '—';
/** Comparison table: [feature, Starter, Growth, Scale, Enterprise]. */
export const COMPARE: [group: string, rows: [string, string, string, string, string][]][] = [
  ['Booking', [['Locations', '1', '3', 'Unlimited', 'Unlimited'], ['Team members', '3', '10', 'Unlimited', 'Unlimited'], ['Live availability & pricing engine', Y, Y, Y, Y], ['Edit after booking with versions', Y, Y, Y, Y], ['Booking calendar', Y, Y, Y, Y], ['Lead pipeline & follow-ups', N, Y, Y, Y]]],
  ['Payments', [['E-signature & online deposits', Y, Y, Y, Y], ['Auto-charged balances', Y, Y, Y, Y], ['Rain checks, credits & refunds', Y, Y, Y, Y], ['Manual payments & POs', Y, Y, Y, Y]]],
  ['Messaging', [['Email automations from your SMTP', Y, Y, Y, Y], ['SMS reminders', N, '500 / mo', '2,000 / mo', 'Custom'], ['HTML template upload', N, Y, Y, Y], ['Quiet hours & message log', Y, Y, Y, Y]]],
  ['Operations', [['Ops board', Y, Y, Y, Y], ['Crew portal & 5-phase checklist', N, Y, Y, Y], ['Live GPS & heads-up texts', N, Y, Y, Y], ['Damage & maintenance flags', N, Y, Y, Y]]],
  ['Reports & admin', [['Reports', '10 core', 'All 32', 'All 32', 'All 32 + custom'], ['Custom domain', N, Y, Y, Y], ['Roles & permissions', 'Basic', Y, Y, Y], ['Audit log', N, Y, Y, Y], ['API & webhooks (when released)', N, N, Y, Y], ['SSO', N, N, N, Y]]],
  ['Support', [['Help center & email', Y, Y, Y, Y], ['Data migration', N, 'Guided', 'Done for you', 'Done for you'], ['Priority support', N, N, Y, Y], ['Dedicated manager & SLA', N, N, N, Y]]],
];
