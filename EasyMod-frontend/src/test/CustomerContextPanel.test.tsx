/**
 * MW-V1 Phase 3 — CustomerContextPanel contract tests (doc 04 rules).
 * Real i18n; domain modules mocked; router navigations captured.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import CustomerContextPanel from '@/app/components/inbox/CustomerContextPanel';
import type { Conversation } from '@/api/types/conversation';

const ciApi = vi.hoisted(() => ({ getPilotStatus: vi.fn(), getCustomer360: vi.fn() }));
const orderApi = vi.hoisted(() => ({ getOrders: vi.fn() }));
const crmApi = vi.hoisted(() => ({
  listCustomerNotes: vi.fn(), listCustomerTags: vi.fn(), listTagVocabulary: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/api/domains/customer-intelligence', () => ciApi);
vi.mock('@/api/domains/order', () => orderApi);
vi.mock('@/api/domains/customer-crm', () => crmApi);
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  customer_id: 'cust-1',
  customer: { id: 'cust-1', name: 'Rina Akter', channel_user_id: 'psid-1' },
  channel: 'facebook',
  title: 'Rina Akter',
  status: 'active',
  hitl: false,
  unreadCount: 0,
  lastMessage: 'hi',
  created_at: '2026-10-20T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
  ...over,
} as Conversation);

const detail360 = {
  customer: { name: 'Rina Akter', page: 'Azal Boutique', last_activity_at: '2026-10-25T08:00:00Z' },
  contactability: { platform: 'facebook', window_open: true, reason: '' },
  state: 'REPEAT_BUYER', state_reasons: [{ code: 'DELIVERED_COUNT', params: { count: 4 } }],
  summary: { total_orders: 6, delivered_orders: 4, returned_orders: 1, delivered_value: 8400, ordered_value: 12000 },
  rto_signal: { available: true, tier: 'verify', list: false, network: false },
  orders: [], conversations: [], opportunities: [], timeline: [],
};

beforeAll(async () => { await i18n.changeLanguage('en'); });

beforeEach(() => {
  vi.clearAllMocks();
  ciApi.getPilotStatus.mockResolvedValue({ customer_intelligence: false, order_confidence_mode: 'off' });
  orderApi.getOrders.mockResolvedValue([
    { id: 'o9', orderNumber: 'ORD-1001', status: 'processing', total: 1490, customerName: 'Rina Akter', customerId: 'cust-1' },
  ]);
  crmApi.listCustomerNotes.mockResolvedValue({ data: [], total: 0 });
  crmApi.listCustomerTags.mockResolvedValue({ data: [] });
});

describe('CustomerContextPanel', () => {
  it('flag OFF: identity+orders render, ZERO customer-intelligence reads', async () => {
    render(<CustomerContextPanel conversation={conversation()} />);
    await waitFor(() => expect(screen.getByText('Rina Akter')).toBeInTheDocument());
    expect(ciApi.getCustomer360).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delivered value/)).not.toBeInTheDocument();
    expect(orderApi.getOrders).toHaveBeenCalledWith({ customer_id: 'cust-1', limit: 3 });
  });

  it('flag ON: relationship + RTO facts appear with honest labels', async () => {
    ciApi.getPilotStatus.mockResolvedValue({ customer_intelligence: true, order_confidence_mode: 'off' });
    ciApi.getCustomer360.mockResolvedValue(detail360);
    render(<CustomerContextPanel conversation={conversation()} />);

    expect(await screen.findByText(/Delivered value/)).toBeInTheDocument();
    expect(screen.getByText(/৳?8,?400|8400/)).toBeInTheDocument();
    expect(screen.queryByText(/paid|received cash/i)).not.toBeInTheDocument();
    expect(screen.getByText(/delivery-risk/i)).toBeInTheDocument(); // neutral RTO wording
    expect(ciApi.getCustomer360).toHaveBeenCalledWith('cust-1');
  });

  it('order rows use authoritative status strings and canonical deep link', async () => {
    render(<CustomerContextPanel conversation={conversation()} />);
    const row = await screen.findByText('ORD-1001');
    expect(row.parentElement?.textContent).toContain('processing');
    fireEvent.click(screen.getByRole('button', { name: /open order/i }));
    expect(navigate).toHaveBeenCalledWith('/orders?orderId=o9');
  });

  it('360 failure degrades the relationship section only — operations stay usable', async () => {
    ciApi.getPilotStatus.mockResolvedValue({ customer_intelligence: true, order_confidence_mode: 'off' });
    ciApi.getCustomer360.mockRejectedValue(new Error('boom'));
    render(<CustomerContextPanel conversation={conversation()} />);

    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.getByText('ORD-1001')).toBeInTheDocument();
  });

  it('conversation with no customer id: honest state, ZERO data calls beyond pilot status', async () => {
    render(<CustomerContextPanel conversation={conversation({ customer_id: null as unknown as string, customer: undefined })} />);
    await waitFor(() => expect(screen.getByText(/not linked/i)).toBeInTheDocument());
    expect(orderApi.getOrders).not.toHaveBeenCalled();
    expect(ciApi.getCustomer360).not.toHaveBeenCalled();
    expect(crmApi.listCustomerNotes).not.toHaveBeenCalled();
    expect(crmApi.listCustomerTags).not.toHaveBeenCalled();
  });

  it('switching conversations discards the slower previous load', async () => {
    const slow: { resolve?: (v: unknown) => void } = {};
    ciApi.getPilotStatus.mockResolvedValue({ customer_intelligence: true, order_confidence_mode: 'off' });
    ciApi.getCustomer360.mockImplementation((id: string) => {
      if (id === 'cust-1') return new Promise((r) => { slow.resolve = r; });
      return Promise.resolve({ ...detail360, summary: { ...detail360.summary, delivered_value: 999 } });
    });
    const { rerender } = render(<CustomerContextPanel conversation={conversation()} />);
    await screen.findByText('ORD-1001');
    rerender(<CustomerContextPanel conversation={conversation({ id: 'conv-2', customer_id: 'cust-2', customer: { name: 'Karim' } as never })} />);

    expect(await screen.findByText(/৳?999/)).toBeInTheDocument();
    slow.resolve?.(detail360); // late arrival for the PREVIOUS conversation must not overwrite
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/৳?8,?400|8400/)).not.toBeInTheDocument();
  });
});
