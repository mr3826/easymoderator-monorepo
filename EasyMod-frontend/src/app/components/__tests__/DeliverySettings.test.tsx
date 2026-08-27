import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeliverySettings from '../DeliverySettings';

const mocks = vi.hoisted(() => ({
  getDeliverySettings: vi.fn(),
  connectDeliveryProvider: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/api', () => ({ apiClient: mocks }));
vi.mock('@shared/lib/http/errors', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'manageShop.deliverySettings.title': 'Delivery settings',
        'manageShop.deliverySettings.subtitle': 'Configure delivery',
        'manageShop.deliverySettings.zoneInsideDhaka': 'Inside Dhaka',
        'manageShop.deliverySettings.zoneSubDhaka': 'Sub Dhaka',
        'manageShop.deliverySettings.zoneOutsideDhaka': 'Outside Dhaka',
        'manageShop.deliverySettings.connected': 'Connected',
        'manageShop.deliverySettings.statusActive': 'Active',
        'manageShop.deliverySettings.statusInactive': 'Inactive',
        'manageShop.deliverySettings.statusNotConnected': 'Not connected',
        'manageShop.deliverySettings.useSandbox': 'Use sandbox',
        'manageShop.deliverySettings.enterCredentials': `Enter ${values?.provider || 'provider'} credentials`,
        'manageShop.deliverySettings.defaultDeliveryCharge': 'Default charge',
        'manageShop.deliverySettings.codEnabled': 'COD enabled',
        'manageShop.deliverySettings.codCharge': 'COD charge',
        'manageShop.deliverySettings.nonRefundable': 'Non-refundable',
        'manageShop.deliverySettings.areaPricing': 'Area pricing',
        'manageShop.deliverySettings.weightPricing': 'Weight pricing',
        'manageShop.deliverySettings.saveSettings': 'Save settings',
        'manageShop.deliverySettings.noTiers': 'No tiers',
        'manageShop.deliverySettings.addTier': 'Add tier',
        'manageShop.deliverySettings.testConnection': 'Test connection',
        'manageShop.deliverySettings.setAsDefault': 'Set as default',
        'manageShop.deliverySettings.saveConnect': 'Save and connect',
        'manageShop.deliverySettings.deactivate': 'Deactivate',
        'manageShop.deliverySettings.activate': 'Activate',
        'common.connect': 'Connect',
        'common.disconnect': 'Disconnect',
        'common.cancel': 'Cancel',
      };
      return labels[key] || key;
    },
  }),
}));

const settings = {
  default_delivery_charge: 60,
  cod_enabled: false,
  cod_charge: 0,
  non_refundable: false,
  area_pricing: [],
  weight_tiers: [],
};

const status = (isConnected: boolean, isSandbox: boolean) => ({
  provider: 'pathao' as const,
  display_name: 'Pathao Courier',
  is_connected: isConnected,
  is_active: false,
  is_sandbox: isSandbox,
  metadata: {},
  last_validated_at: null,
  connected_at: null,
});

describe('DeliverySettings sandbox hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ data: { data: { payment: [], delivery: [] } } });
    mocks.put.mockResolvedValue({ data: { data: { payment: [], delivery: [] } } });
    mocks.connectDeliveryProvider.mockResolvedValue({ success: true });
  });

  it('displays the persisted Pathao sandbox environment after reload', async () => {
    mocks.getDeliverySettings.mockResolvedValue({
      providers: [status(true, true)],
      settings,
    });

    render(<DeliverySettings />);

    expect(await screen.findByTestId('pathao-environment')).toHaveTextContent('Sandbox');
  });

  it('hydrates the reconnect form and sends the persisted sandbox selection', async () => {
    mocks.getDeliverySettings
      .mockResolvedValueOnce({ providers: [status(false, true)], settings })
      .mockResolvedValueOnce({ providers: [status(true, true)], settings });

    render(<DeliverySettings />);
    await waitFor(() => expect(mocks.getDeliverySettings).toHaveBeenCalledTimes(1));

    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    fireEvent.click(connectButtons[0]);

    const sandbox = await screen.findByRole('checkbox', { name: 'Use sandbox' }) as HTMLInputElement;
    expect(sandbox.checked).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Enter your Pathao Client ID'), { target: { value: 'client' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your Pathao Client Secret'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByPlaceholderText('merchant@example.com'), { target: { value: 'merchant@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your Pathao account password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }));

    await waitFor(() => expect(mocks.connectDeliveryProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'pathao',
      is_sandbox: true,
    })));
  });
});
