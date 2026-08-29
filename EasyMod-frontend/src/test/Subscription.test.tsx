import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Subscription from '@/app/components/Subscription';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: any) => {
      if (options?.returnObjects) {
        if (key === 'subscription.planFeatures') return ['Messenger replies', 'Order capture'];
        return [];
      }
      const map: Record<string, string> = {
        'subscription.title': 'Plan & Billing',
        'subscription.subtitle': 'Choose a plan',
        'subscription.currentPlan': 'Current plan',
        'subscription.plansTitle': 'Plans',
        'subscription.plansSubtitle': 'Choose a plan',
        'subscription.usageTitle': 'This period usage',
        'subscription.usageSubtitle': 'Usage',
        'subscription.conversationsUsed': 'Customer conversations',
        'subscription.ordersCreated': 'Orders Created',
        'subscription.productsUsed': 'Products Used',
        'subscription.planIncludes': 'Plan includes',
        'subscription.billingTitle': 'Billing Summary',
        'subscription.basePlan': 'Base Plan Price',
        'subscription.invoicesTitle': 'Invoices',
        'subscription.invoiceColumns.id': 'ID',
        'subscription.invoiceColumns.period': 'Period',
        'subscription.invoiceColumns.type': 'Type',
        'subscription.invoiceColumns.amount': 'Amount',
        'subscription.invoiceColumns.status': 'Status',
        'subscription.invoiceColumns.action': 'Action',
        'subscription.paid': 'Paid',
        'subscription.pending': 'Pending',
        'common.active': 'Active',
      };
      if (key === 'subscription.includedConversations') return `Included allowance: ${options?.count}`;
      return map[key] || key;
    },
  }),
}));

vi.mock('@/api', () => ({
  apiClient: {
    getSubscription: vi.fn().mockResolvedValue({
      subscription: {
        plan_code: 'SHURU',
        plan_name: 'Shuru',
        plan_price: 0,
        billing_cycle: 'monthly',
        status: 'active',
        conversations_limit: 100,
        conversations_used: 10,
        topup_balance: 0,
        current_period_start: '2024-01-01T00:00:00.000Z',
        current_period_end: '2024-02-01T00:00:00.000Z',
        next_billing_date: '2024-02-01T00:00:00.000Z',
        features: {},
      },
      effective_conversation_limit: 100,
      conversation_quota_exhausted: false,
      period: { start: '2024-01-01T00:00:00.000Z', end: '2024-02-01T00:00:00.000Z' },
      usage: {
        conversations: { used: 10, limit: 100, included_limit: 100, topup_balance: 0, status: 'safe', percentage: 10 },
        orders: { used: 5, limit: -1, status: 'safe', percentage: 0 },
        products: { used: 20, limit: -1, status: 'safe', percentage: 0 },
      },
      partner_eligibility: { delivered_orders_30d: 0, minimum_delivered_orders: 300, eligible: false },
      extra_usage: { conversations: 0, charge: 0 },
    }),
    getSubscriptionInvoices: vi.fn().mockResolvedValue([
      { id: 'inv-1', invoice_number: 'INV-1', billing_period: 'Jan 2024', amount: 0, status: 'paid', invoice_type: 'subscription', created_at: '2024-01-01' },
    ]),
    getSubscriptionPlans: vi.fn().mockResolvedValue([]),
    getTopupPacks: vi.fn().mockResolvedValue([]),
    subscribeToPlan: vi.fn(),
    payInvoice: vi.fn(),
    renewSubscription: vi.fn(),
    completeTopup: vi.fn(),
    completeInvoicePayment: vi.fn(),
  },
}));

vi.mock('@/app/lib/auth', () => ({ authService: { getCurrentShopId: vi.fn().mockReturnValue('shop-1') } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/app/components/ui/progress', () => ({ Progress: ({ value }: any) => <div data-testid="progress" data-value={value} /> }));
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return {
    AlertCircle: Icon, Check: Icon, CheckCircle2: Icon, CreditCard: Icon, Download: Icon,
    Eye: Icon, MessageSquare: Icon, Package: Icon, ShoppingCart: Icon, TrendingUp: Icon,
  };
});

const renderWithRouter = () => render(<BrowserRouter><Subscription /></BrowserRouter>);

describe('Subscription', () => {
  it('renders Shuru details and effective usage metrics', async () => {
    renderWithRouter();
    await waitFor(() => expect(screen.getAllByText('Shuru').length).toBeGreaterThan(0));
    expect(screen.getByText('Plan & Billing')).toBeInTheDocument();
    expect(screen.getAllByTestId('progress')).toHaveLength(3);
    expect(screen.getByText(/Included allowance: 100/)).toBeInTheDocument();
  });

  it('displays invoice history without exposing a payment button when bKash is disabled', async () => {
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('Jan 2024')).toBeInTheDocument());
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay with bKash/i })).not.toBeInTheDocument();
  });
});
