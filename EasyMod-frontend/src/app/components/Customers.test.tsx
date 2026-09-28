import { describe, expect, it } from 'vitest';
import { normalizeLegacyCustomer } from './Customers';

describe('normalizeLegacyCustomer', () => {
  it('maps the backend phone and channel_type fields to the legacy view model', () => {
    const customer = normalizeLegacyCustomer({
      id: 'customer-1',
      shop_id: 'shop-1',
      name: 'Pilot Customer',
      phone: '01700000000',
      channel_type: 'messenger',
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:00:00.000Z',
    } as never);

    expect(customer.number).toBe('01700000000');
    expect(customer.channel).toBe('messenger');
  });

  it('keeps explicit legacy fields and defaults an unusable channel safely', () => {
    const customer = normalizeLegacyCustomer({
      id: 'customer-2',
      shop_id: 'shop-1',
      name: 'Manual Customer',
      number: '01800000000',
      channel: undefined,
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:00:00.000Z',
    } as never);

    expect(customer.number).toBe('01800000000');
    expect(customer.channel).toBe('manual');
  });
});
