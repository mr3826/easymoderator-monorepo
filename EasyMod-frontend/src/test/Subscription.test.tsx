import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Subscription from '@/app/components/Subscription'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (options?.returnObjects) return []
      if (key === 'subscription.planTitle' && options?.plan) return `${options.plan} Plan`
      if (key === 'subscription.price' && options?.price) return `৳${options.price}`
      if (key === 'subscription.nextBilling' && options?.date) return `Next billing: ${options.date}`
      const map: Record<string, string> = {
        'subscription.title': 'Plan & Billing',
        'subscription.noData': 'No subscription data',
        'subscription.paid': 'Paid',
        'subscription.pending': 'Pending',
        'subscription.currentPlan': 'Current Plan',
        'subscription.plansTitle': 'Available Plans',
        'subscription.plansSubtitle': 'Choose a plan',
        'subscription.invoicesTitle': 'Invoices',
        'subscription.invoiceDisclaimer': 'Invoice disclaimer',
        'subscription.invoiceNote': 'Invoice note',
        'subscription.requestInvoice': 'Request Invoice',
        'subscription.planIncludes': 'Plan includes',
        'subscription.invoiceColumns.id': 'ID',
        'subscription.invoiceColumns.period': 'Period',
        'subscription.invoiceColumns.type': 'Type',
        'subscription.invoiceColumns.amount': 'Amount',
        'subscription.invoiceColumns.status': 'Status',
        'subscription.invoiceColumns.action': 'Action',
        'common.active': 'Active',
        'common.inactive': 'Inactive',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Mock the API client
// Note: apiClient methods return response.data.data (the inner payload), not the full HTTP envelope.
vi.mock('@/api', () => ({
  apiClient: {
    getSubscription: vi.fn().mockResolvedValue({
      subscription: {
        plan_name: 'Pro',
        plan_price: '29.99',
        billing_cycle: 'monthly',
        next_billing_date: '2024-02-01',
        status: 'active',
        features: { image_understanding: true }
      },
      usage: {
        conversations: { used: 10, limit: 100, status: 'safe' },
        orders: { used: 5, limit: 50, status: 'safe' },
        products: { used: 20, limit: 100, status: 'safe' }
      },
      extra_usage: { conversations: 0, charge: 0 }
    }),
    getSubscriptionInvoices: vi.fn().mockResolvedValue([
      {
        invoice_number: '1',
        billing_period: 'Jan 2024',
        amount: '29.99',
        status: 'paid',
        invoice_type: 'subscription',
        created_at: '2024-01-01'
      }
    ]),
    purchaseConversationPack: vi.fn().mockResolvedValue({ success: true }),
    updateSubscriptionPlan: vi.fn().mockResolvedValue({ success: true }),
  }
}))

// Mock auth service
vi.mock('@/app/lib/auth', () => ({
  authService: {
    getCurrentShopId: vi.fn().mockReturnValue('shop1')
  }
}))

// Mock subscription features hook used by FeatureGate
vi.mock('@/app/lib/useSubscriptionFeatures', () => ({
  useSubscriptionFeatures: vi.fn().mockReturnValue({
    features: { image_understanding: true, advanced_ai: true },
    loading: false,
  }),
}))

// Render FeatureGate children directly (bypass the lock overlay)
vi.mock('@/app/components/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock UI components
vi.mock('@/app/components/ui/progress', () => ({
  Progress: ({ value }: any) => <div data-testid="progress" data-value={value} />
}))

vi.mock('@/app/components/ui/badge', () => ({
  Badge: ({ children }: any) => <div data-testid="badge">{children}</div>
}))

vi.mock('@/app/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <button role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} />
  ),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Mock lucide-react icons — include all icons used by Subscription.tsx
vi.mock('lucide-react', () => ({
  Receipt: () => <div data-testid="receipt-icon" />,
  AlertCircle: () => <div data-testid="alert-circle-icon" />,
  CheckCircle2: () => <div data-testid="check-circle-icon" />,
  Download: () => <div data-testid="download-icon" />,
  Eye: () => <div data-testid="eye-icon" />,
  TrendingUp: () => <div data-testid="trending-up-icon" />,
  Package: () => <div data-testid="package-icon" />,
  ShoppingCart: () => <div data-testid="shopping-cart-icon" />,
  MessageSquare: () => <div data-testid="message-square-icon" />,
  CreditCard: () => <div data-testid="credit-card-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  Lock: () => <div data-testid="lock-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
  X: () => <div data-testid="x-icon" />,
}))

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Subscription', () => {
  it('renders subscription page with plan details and usage', async () => {
    renderWithRouter(<Subscription />)

    await waitFor(() => {
      expect(screen.getByText('Pro Plan')).toBeInTheDocument()
    })

    expect(screen.getByText('Plan & Billing')).toBeInTheDocument()
    // ৳29.99 appears in both the plan price and invoice amount — use getAllByText
    expect(screen.getAllByText('৳29.99').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('progress')).toHaveLength(3)
  })

  it('displays invoices', async () => {
    renderWithRouter(<Subscription />)

    await waitFor(() => {
      expect(screen.getByText('Jan 2024')).toBeInTheDocument()
    })

    expect(screen.getAllByText('৳29.99').length).toBeGreaterThan(0)
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })
})
