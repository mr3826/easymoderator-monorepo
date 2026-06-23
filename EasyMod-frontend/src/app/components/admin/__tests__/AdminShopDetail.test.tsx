import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminShopDetail from '../AdminShopDetail';

const mocks = vi.hoisted(() => ({
  getShop: vi.fn(),
  getShopChannels: vi.fn(),
  getShopBilling: vi.fn(),
  emergencyAiOff: vi.fn(),
  markReconnect: vi.fn(),
  extendTrial: vi.fn(),
  addCredits: vi.fn(),
  setStatus: vi.fn(),
  useIsPlatformAdmin: vi.fn(),
}));

vi.mock('@/api/domains/admin', () => ({
  adminApi: {
    getShop: mocks.getShop,
    getShopChannels: mocks.getShopChannels,
    getShopBilling: mocks.getShopBilling,
    emergencyAiOff: mocks.emergencyAiOff,
    markReconnect: mocks.markReconnect,
    extendTrial: mocks.extendTrial,
    addCredits: mocks.addCredits,
    setStatus: mocks.setStatus,
  },
}));

vi.mock('@/shared/lib/auth/useIsPlatformAdmin', () => ({
  useIsPlatformAdmin: mocks.useIsPlatformAdmin,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ shopId: 'shop-1' }),
  };
});

describe('AdminShopDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getShop.mockResolvedValue({
      shop: { shopName: 'Demo Shop' },
      owner: { email: 'owner@example.com' },
      subscription: { planName: 'Pro', status: 'active' },
      usage: { conversationsUsed: 1, conversationsLimit: 100 },
      onboarding: { completed: true },
    });
    mocks.getShopChannels.mockResolvedValue([{ id: 'ch-1', displayName: 'Main Page', platform: 'facebook', status: 'CONNECTED' }]);
    mocks.getShopBilling.mockResolvedValue({
      planName: 'Pro',
      status: 'active',
      conversationsUsed: 1,
      conversationsLimit: 100,
      topupBalance: 0,
    });
    mocks.emergencyAiOff.mockResolvedValue({});
    mocks.markReconnect.mockResolvedValue({});
    mocks.extendTrial.mockResolvedValue({});
    mocks.addCredits.mockResolvedValue({});
    mocks.setStatus.mockResolvedValue({});
  });

  it('disables mutation controls for SUPPORT_ADMIN users', async () => {
    mocks.useIsPlatformAdmin.mockReturnValue({ loading: false, role: 'SUPPORT_ADMIN' });

    render(<AdminShopDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    expect(await screen.findByRole('button', { name: 'Emergency: stop AI' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Mark reconnect' })).toBeDisabled();
    expect(screen.getByText('SUPER_ADMIN required for channel actions.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(await screen.findByRole('button', { name: 'Extend trial 7d' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add 50 credits' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeDisabled();
    expect(screen.getByText('SUPER_ADMIN required for billing actions.')).toBeInTheDocument();
  });

  it('allows SUPER_ADMIN users to trigger emergency AI stop', async () => {
    mocks.useIsPlatformAdmin.mockReturnValue({ loading: false, role: 'SUPER_ADMIN' });
    Object.defineProperty(window, 'confirm', {
      value: vi.fn(() => true),
      configurable: true,
    });

    render(<AdminShopDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency: stop AI' }));

    await waitFor(() => expect(mocks.emergencyAiOff).toHaveBeenCalledWith('shop-1'));
  });
});
