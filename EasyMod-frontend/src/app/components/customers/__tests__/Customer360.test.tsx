import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { Customer360Detail, Customer360ListItem, Opportunity } from '@/api/types/customer-intelligence';

const api = vi.hoisted(() => ({
  getPilotStatus: vi.fn(),
  listCustomers360: vi.fn(),
  getCustomer360: vi.fn(),
  listOpportunities: vi.fn(),
  markOpportunityContacted: vi.fn(),
  dismissOpportunity: vi.fn(),
}));
vi.mock('@/api/domains/customer-intelligence', () => api);
vi.mock('../../RtoNetworkSettings', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import Customer360Page from '../Customer360Page';
import CustomerDetailPage from '../CustomerDetailPage';

const customer = (overrides: Partial<Customer360ListItem> = {}): Customer360ListItem => ({
  id: 'c-1',
  name: 'Rahim Uddin',
  phone: '01711111111',
  email: null,
  channel_type: 'messenger',
  profile_pic: null,
  first_seen_at: '2026-09-01T00:00:00Z',
  state: 'REPEAT_BUYER',
  state_reasons: [{ code: 'MULTIPLE_DELIVERIES', params: { delivered: 3 } }],
  total_orders: 4,
  delivered_orders: 3,
  returned_orders: 0,
  delivered_value: 4500,
  last_order_at: '2026-09-20T00:00:00Z',
  last_activity_at: new Date().toISOString(),
  open_opportunity: null,
  ...overrides,
});

const opportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'op-1',
  status: 'OPEN',
  strength: 'HIGH',
  reasons: ['PURCHASE_INTENT', 'ASKED_DELIVERY_CHARGE'],
  signals: [],
  product_refs: [{ product_id: 'p-1', name: 'Black Panjabi', quantity: 2 }],
  customer_id: 'c-2',
  conversation_id: 'conv-9',
  first_signal_at: '2026-09-27T08:00:00Z',
  last_signal_at: '2026-09-27T08:10:00Z',
  detected_at: '2026-09-27T09:00:00Z',
  actioned_at: null,
  converted_order_id: null,
  resolved_at: null,
  resolution_reason: null,
  recommended_action: { code: 'REPLY_IN_INBOX', window_closes_at: '2026-09-28T08:10:00Z' },
  customer: { id: 'c-2', name: 'Karim', channel_type: 'messenger' },
  ...overrides,
});

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/customers" element={<Customer360Page />} />
      <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
      <Route path="/inbox" element={<p>inbox page</p>} />
      <Route path="/orders" element={<p>orders page</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listOpportunities.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
});

describe('Customer 360 list', () => {
  it('shows each customer with a neutral state, order counts and delivered value', async () => {
    api.listCustomers360.mockResolvedValue({
      data: [
        customer(),
        customer({ id: 'c-3', name: 'Salma', state: 'AT_RISK', state_reasons: [{ code: 'RETURNS_NOT_LESS_THAN_DELIVERIES', params: { returned: 2, delivered: 1 } }] }),
      ],
      total: 2, page: 1, pageSize: 20,
    });
    renderAt('/customers');
    const table = await screen.findByTestId('customer-table');
    const row = within(table).getByTestId('customer-row-c-1');
    expect(row).toHaveTextContent('Rahim Uddin');
    expect(row).toHaveTextContent('Repeat buyer');
    expect(row).toHaveTextContent('3 delivered of 4');
    expect(row).toHaveTextContent('4,500');
    // "Return history", never an accusation.
    expect(within(table).getByTestId('customer-row-c-3')).toHaveTextContent('Return history');
    expect(screen.queryByText(/fraud/i)).not.toBeInTheDocument();
  });

  it('searches on the server with the typed term', async () => {
    api.listCustomers360.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    renderAt('/customers');
    await screen.findByText(/No customers yet/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '01711' } });
    await waitFor(() => expect(api.listCustomers360).toHaveBeenLastCalledWith(expect.objectContaining({ search: '01711' })));
    expect(await screen.findByText('No customers match your search.')).toBeInTheDocument();
  });

  it('shows an error with a working retry', async () => {
    api.listCustomers360.mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: [customer()], total: 1, page: 1, pageSize: 20 });
    renderAt('/customers');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('customer-row-c-1')).toBeInTheDocument();
  });

  it('opens the customer detail from a row', async () => {
    api.listCustomers360.mockResolvedValue({ data: [customer()], total: 1, page: 1, pageSize: 20 });
    api.getCustomer360.mockReturnValue(new Promise(() => {}));
    renderAt('/customers');
    fireEvent.click(await screen.findByTestId('customer-row-c-1'));
    expect(await screen.findByText('Back to customers')).toBeInTheDocument();
    expect(api.getCustomer360).toHaveBeenCalledWith('c-1');
  });
});

describe('Sales opportunities', () => {
  it('lists open opportunities with plain-language reasons and the next manual step', async () => {
    api.listOpportunities.mockResolvedValue({ data: [opportunity()], total: 1, page: 1, pageSize: 20 });
    renderAt('/customers?tab=opportunities');
    const card = await screen.findByTestId('opportunity-op-1');
    expect(card).toHaveTextContent('Karim');
    expect(card).toHaveTextContent('Strong interest');
    expect(card).toHaveTextContent('Said they want to order');
    expect(card).toHaveTextContent('Asked about delivery charge');
    expect(card).toHaveTextContent('Black Panjabi × 2');
    expect(within(card).getByTestId('opportunity-recommended-action')).toHaveTextContent('Reply in the Inbox before');
    expect(screen.getByTestId('customers-tab-opportunities')).toHaveTextContent('1');
  });

  it('marks an opportunity contacted through the API', async () => {
    api.listOpportunities.mockResolvedValue({ data: [opportunity()], total: 1, page: 1, pageSize: 20 });
    api.markOpportunityContacted.mockResolvedValue(opportunity({ status: 'ACTIONED' }));
    renderAt('/customers?tab=opportunities');
    fireEvent.click(await screen.findByRole('button', { name: /Mark contacted/ }));
    await waitFor(() => expect(api.markOpportunityContacted).toHaveBeenCalledWith('op-1'));
    expect(await screen.findByText('Contacted')).toBeInTheDocument();
  });

  it('dismisses with a reason and removes the card', async () => {
    api.listOpportunities.mockResolvedValue({ data: [opportunity()], total: 1, page: 1, pageSize: 20 });
    api.dismissOpportunity.mockResolvedValue(opportunity({ status: 'DISMISSED' }));
    renderAt('/customers?tab=opportunities');
    const card = await screen.findByTestId('opportunity-op-1');
    fireEvent.click(within(card).getByRole('button', { name: /Dismiss/ }));
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'ALREADY_HANDLED' } });
    fireEvent.click(within(card).getAllByRole('button', { name: 'Dismiss' }).pop()!);
    await waitFor(() => expect(api.dismissOpportunity).toHaveBeenCalledWith('op-1', 'ALREADY_HANDLED'));
    await waitFor(() => expect(screen.queryByTestId('opportunity-op-1')).not.toBeInTheDocument());
  });

  it('never offers a follow-up for a customer who opted out', async () => {
    api.listOpportunities.mockResolvedValue({
      data: [opportunity({ recommended_action: { code: 'DO_NOT_CONTACT' } })], total: 1, page: 1, pageSize: 20,
    });
    renderAt('/customers?tab=opportunities');
    const card = await screen.findByTestId('opportunity-op-1');
    expect(card).toHaveTextContent('This customer asked not to be messaged.');
    expect(within(card).queryByRole('button', { name: /Open conversation/ })).not.toBeInTheDocument();
  });

  it('opens the conversation in the Inbox — the send itself happens there', async () => {
    api.listOpportunities.mockResolvedValue({ data: [opportunity()], total: 1, page: 1, pageSize: 20 });
    renderAt('/customers?tab=opportunities');
    fireEvent.click(await screen.findByRole('button', { name: /Open conversation/ }));
    expect(await screen.findByText('inbox page')).toBeInTheDocument();
  });

  it('explains the empty state', async () => {
    renderAt('/customers?tab=opportunities');
    expect(await screen.findByText(/No open sales opportunities right now/)).toBeInTheDocument();
  });
});

describe('Customer detail', () => {
  const detail = (): Customer360Detail => ({
    customer: {
      id: 'c-1', name: 'Rahim Uddin', phone: '01711111111', email: null, channel_type: 'messenger',
      profile_pic: null, first_seen_at: '2026-09-01T00:00:00Z', last_activity_at: '2026-09-26T00:00:00Z',
      last_inbound_at: '2026-09-26T00:00:00Z', page: { id: 'pg', name: 'Rahim Fashion', platform: 'facebook' },
    },
    contactability: { platform: 'facebook', window_open: false, window_closes_at: null, reason: 'OUTSIDE_24H_WINDOW' },
    state: 'REPEAT_BUYER',
    state_reasons: [{ code: 'MULTIPLE_DELIVERIES', params: { delivered: 2 } }],
    state_rules_version: 'customer-state/1.0.0',
    summary: {
      total_orders: 3, delivered_orders: 2, returned_orders: 0, cancelled_orders: 1, in_progress_orders: 0,
      ordered_value: 3000, delivered_value: 3000, first_order_at: '2026-09-02T00:00:00Z',
      last_order_at: '2026-09-20T00:00:00Z', last_delivered_at: '2026-09-22T00:00:00Z',
    },
    rto_signal: { available: true, tier: 'clear', risk_score: 0, list: null, network: null },
    orders: [
      { id: 'o-1', order_number: 'ORD-1', created_at: '2026-09-20T00:00:00Z', total: 2000, order_status: 'delivered', payment_status: 'pending', delivery_status: 'delivered', delivery_provider: 'pathao', outcome: 'DELIVERED', link: 'CUSTOMER', confidence: { decision: 'READY', resolution: null, last_gate_result: 'ALLOWED', outcome: 'DELIVERED' } },
      { id: 'o-2', order_number: 'ORD-2', created_at: '2026-09-10T00:00:00Z', total: 500, order_status: 'cancelled', payment_status: 'pending', delivery_status: null, delivery_provider: null, outcome: 'CANCELLED', link: 'PHONE_MATCH', confidence: null },
    ],
    conversations: [],
    opportunities: [],
    timeline: [
      { type: 'ORDER_DELIVERED', at: '2026-09-22T00:00:00Z', order_id: 'o-1', order_number: 'ORD-1' },
      { type: 'ORDER_CANCELLED', at: '2026-09-11T00:00:00Z', order_id: 'o-2', order_number: 'ORD-2', approximate_time: true },
    ],
  });

  it('shows the commerce summary, delivery signal, orders and history for this customer', async () => {
    api.getCustomer360.mockResolvedValue(detail());
    renderAt('/customers/c-1');
    expect(await screen.findByRole('heading', { name: 'Rahim Uddin' })).toBeInTheDocument();
    expect(screen.getByTestId('customer-state')).toHaveTextContent('Repeat buyer');
    expect(screen.getByTestId('commerce-summary')).toHaveTextContent('Values are the recorded order totals.');
    expect(screen.getByTestId('rto-signal')).toHaveTextContent('No return-risk signal');
    const orders = screen.getByTestId('customer-orders');
    expect(orders).toHaveTextContent('#ORD-1');
    expect(orders).toHaveTextContent('Ready to ship');
    expect(within(orders).getByText('Matched by phone')).toBeInTheDocument();
    const timeline = screen.getByTestId('customer-timeline');
    expect(timeline).toHaveTextContent('Order #ORD-1 delivered');
    expect(timeline).toHaveTextContent('approximate time');
    expect(screen.getByTestId('reply-window')).toHaveTextContent('Reply window closed');
  });

  it('opens an order from the customer', async () => {
    api.getCustomer360.mockResolvedValue(detail());
    renderAt('/customers/c-1');
    fireEvent.click(await screen.findByRole('button', { name: '#ORD-1' }));
    expect(await screen.findByText('orders page')).toBeInTheDocument();
  });

  it('shows not-found for a customer outside this shop', async () => {
    api.getCustomer360.mockRejectedValue({ statusCode: 404, type: 'NOT_FOUND' });
    renderAt('/customers/other');
    expect(await screen.findByText('Customer not found.')).toBeInTheDocument();
  });
});
