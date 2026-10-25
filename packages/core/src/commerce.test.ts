import { describe, expect, it } from 'vitest';
import { bookingRequirements } from './commerce';

const complete = {
  billing: { name: 'Maria Gonzalez', email: 'maria@example.com', phone: '512-555-0142', address: { line1: '1890 Ranch Shopping Center', city: 'Cedar Park', region: 'TX', postalCode: '78613' } },
  eventStreet: '1890 Ranch Shopping Center',
  contactName: 'Maria',
  contactMobile: '512-555-0198',
  contactConfirmed: true,
};

describe('bookingRequirements (Odoo "Still required to continue")', () => {
  it('nothing is missing on a complete order', () => {
    expect(bookingRequirements(complete)).toEqual([]);
  });

  it('lists what is missing, in form order; blanks count as missing', () => {
    expect(bookingRequirements({ ...complete, billing: { ...complete.billing, email: '  ', address: { ...complete.billing.address, postalCode: '' } }, contactMobile: null, contactConfirmed: false }))
      .toEqual(['Email', 'ZIP code', 'Event day mobile phone', 'Confirm the event day point of contact']);
  });

  it('a missing billing address is reported field by field', () => {
    expect(bookingRequirements({ ...complete, billing: { ...complete.billing, address: null } })).toEqual(['Billing address', 'City', 'State', 'ZIP code']);
  });
});
