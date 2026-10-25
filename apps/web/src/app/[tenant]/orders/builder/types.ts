import type { ProductPricing, Role, ServiceMode } from '@rental/core';

export type Addr = { line1: string; line2: string; city: string; region: string; postalCode: string; country: string; lat?: number; lng?: number };

export type BuilderLocation = {
  id: string; name: string; code: string; timezone: string; lat: number | null; lng: number | null; isPrimary: boolean; taxPercent: number;
  rules: { unit: 'mi' | 'km'; freeDistance: number; rateStaffed: number; rateDropoff: number }; paused: boolean;
};

export type BuilderProduct = {
  id: string; name: string; kind: string; categoryId: string | null; icon: string | null; tint: string | null; imageUrl: string | null;
  pricing: ProductPricing; branchPrices: { locationId: string; mode: ServiceMode; priceCents: number }[]; minHours: number | null; taxable: boolean;
  turnaroundMinutes: number | null; suggestedAddonIds: string[]; tracking: string; fromCents: number; active: boolean;
};

export type BuilderCustomer = {
  id: string; name: string; firstName: string | null; email: string | null; phone: string | null; phoneSecondary: string | null; country: string;
  taxExempt: boolean; orderCount: number; tags: string[]; source: string | null; billingAddress: Addr;
  addresses: { id: string; label: string; kind: string; address: Addr }[];
};

export type BuilderCredit = { id: string; code: string; kind: string; label: string; balanceCents: number; validUntil: string | null; reason: string | null };

export type Billing = { name?: string; email?: string; phone?: string; phone2?: string; address?: Partial<Addr> };

export type BuilderOrder = {
  id: string; number: string; status: string; version: number; locationId: string; customerId: string; eventType: string | null;
  startsAt: string; endsAt: string; eventLocationName: string | null; eventAddress: Addr; customerAddressId: string | null;
  contact: { name: string; mobile: string; email: string; confirmed: boolean };
  eventMiles: number | null; milesOverridden: boolean; travelInfo: Record<string, unknown> | null;
  setupSurface: string | null; eventLocationFee: boolean; eventLocationFeeCents: number; billing: Billing;
  salespersonUserId: string | null; referredByCustomerId: string | null; source: string | null;
  damageWaiver: boolean; damageWaiverPercent: number; travelFeeCents: number; travelFeeOverridden: boolean;
  discountKind: 'percent' | 'amount' | null; discountValue: number | null; couponCode: string | null; couponCents: number;
  taxPercent: number; taxOverridden: boolean; depositKind: 'percent' | 'amount' | 'none'; depositValue: number;
  internalNotes: string; customerNotes: string; totalCents: number; depositDueCents: number; paidCents: number; creditCents: number;
  unpaidReason: string | null; expectedPaymentOn: string | null; followUpNotes: string | null; cancelReason: string | null; bookedAt: string | null;
  lines: { productId: string | null; name: string; serviceMode: ServiceMode; quantity: number; taxable: boolean; flatRate: boolean; unitCents: number; priceOverridden: boolean; setupSurface: string | null }[];
  credits: { creditId: string; amountCents: number }[];
  payments: { id: string; number: string; method: string; amountCents: number; reference: string | null; receivedAt: string; status: string }[];
  versions: { version: number; action: string; diff: Record<string, { from: string; to: string }>; totals: { totalCents?: number }; actorName: string | null; reason: string | null; at: string }[];
};

export type BuilderData = {
  slug: string; currency: string; country: string; orgTimezone: string;
  locations: BuilderLocation[]; defaultLocationId: string | null; defaultDate: string | null;
  booking: {
    surfaces: { code: string; label: string; feeCents: number }[]; waiverPercent: number; waiverDefaultOn: boolean; depositPercent: number;
    cleanupMinutes: number; locationFeeCents: number; minimumBookingCents: number;
  };
  products: BuilderProduct[]; categories: { id: string; name: string }[]; salespeople: { userId: string; name: string }[];
  me: { userId: string; role: Role };
  perms: { create: boolean; overridePrice: boolean; overrideTax: boolean; recordPayment: boolean; refund: boolean; editCustomers: boolean };
  readOnly: boolean;
  customer: BuilderCustomer | null;
  credits: BuilderCredit[];
  order: BuilderOrder | null;
};

/** One editable line in the builder. `price` is the typed unit price ('' = automatic). */
export type DraftLine = {
  key: string; productId: string | null; name: string; serviceMode: ServiceMode; quantity: number; taxable: boolean; flatRate: boolean;
  price: string; setupSurface: string | null;
};

export type DepositRule = '30' | '50' | 'full' | 'none' | 'custom';

export type Draft = {
  locationId: string;
  customer: BuilderCustomer | null;
  billing: { name: string; email: string; phone: string; phone2: string; address: Addr };
  salespersonUserId: string; source: string; referredBy: { id: string; name: string } | null;
  eventType: string; date: string; start: string; durationMin: number;
  addressChoice: string; // 'saved:<id>' | 'billing' | 'other'
  eventAddress: Addr; saveAddress: boolean; eventLocationName: string;
  miles: string; milesOverridden: boolean; depotId: string | null; milesNote: string | null;
  setupSurface: string; eventLocationFee: boolean; eventLocationFeeAmount: string;
  contact: { name: string; mobile: string; email: string; confirmed: boolean };
  lines: DraftLine[];
  internalNotes: string; customerNotes: string;
  damageWaiver: boolean; waiverPercent: string;
  travelOverride: string | null;
  discountKind: 'percent' | 'amount'; discountValue: string;
  couponCode: string; coupon: { code: string; kind: 'percent' | 'amount'; value: number; label: string } | null;
  taxPercent: string; taxOverridden: boolean;
  credits: Record<string, { on: boolean; amount: string }>;
  depositRule: DepositRule; depositCustomKind: 'percent' | 'amount'; depositCustomValue: string;
};
