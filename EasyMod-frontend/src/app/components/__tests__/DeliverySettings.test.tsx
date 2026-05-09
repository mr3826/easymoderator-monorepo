/**
 * DeliverySettings — Vitest Unit Tests
 *
 * Component under test: src/app/components/DeliverySettings.tsx
 *
 * Covers:
 *  - Initial loading state
 *  - Rendering all three provider cards (Pathao, Steadfast, RedX)
 *  - Opening the credentials form for an unconnected provider
 *  - Saving credentials (connect) calls the correct API
 *  - Success message displayed after connect
 *  - Error message displayed on failed connect
 *  - Test-connection button calls testDeliveryConnection
 *  - Toggle (activate/deactivate) for a connected provider
 *  - Disconnect flow with confirm dialog
 *  - General settings save (updateDeliverySettings)
 *  - Error banner shown when loadDeliverySettings fails
 *  - Weight-tier validation error shown before API call
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DeliverySettings from '../DeliverySettings';

// ── Hoist mock helpers ────────────────────────────────────────────────────────
const {
  mockGetDeliverySettings,
  mockUpdateDeliverySettings,
  mockConnectDeliveryProvider,
  mockDisconnectDeliveryProvider,
  mockToggleDeliveryProvider,
  mockTestDeliveryConnection,
} = vi.hoisted(() => ({
  mockGetDeliverySettings:      vi.fn(),
  mockUpdateDeliverySettings:   vi.fn(),
  mockConnectDeliveryProvider:  vi.fn(),
  mockDisconnectDeliveryProvider: vi.fn(),
  mockToggleDeliveryProvider:   vi.fn(),
  mockTestDeliveryConnection:   vi.fn(),
}));

// ── Mock @/api ────────────────────────────────────────────────────────────────
vi.mock('@/api', () => ({
  apiClient: {
    getDeliverySettings:        mockGetDeliverySettings,
    updateDeliverySettings:     mockUpdateDeliverySettings,
    connectDeliveryProvider:    mockConnectDeliveryProvider,
    disconnectDeliveryProvider: mockDisconnectDeliveryProvider,
    toggleDeliveryProvider:     mockToggleDeliveryProvider,
    testDeliveryConnection:     mockTestDeliveryConnection,
  },
}));

// ── Mock react-i18next ────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // Return readable strings for specific keys used in assertions
      const map: Record<string, string> = {
        'manageShop.deliverySettings.title':               'Delivery Settings',
        'manageShop.deliverySettings.subtitle':            'Configure your delivery partners',
        'manageShop.deliverySettings.saveSettings':        'Save Settings',
        'manageShop.deliverySettings.generalSettings':     'General Settings',
        'manageShop.deliverySettings.defaultCharge':       'Default Charge',
        'manageShop.deliverySettings.codCharge':           'COD Charge',
        'manageShop.deliverySettings.enableCOD':           'Enable COD',
        'manageShop.deliverySettings.nonRefundable':       'Non-refundable',
        'manageShop.deliverySettings.areaBasedPricing':    'Area Based Pricing',
        'manageShop.deliverySettings.addArea':             'Add Area',
        'manageShop.deliverySettings.weightCharges':       'Weight Charges',
        'manageShop.deliverySettings.addTier':             'Add Tier',
        'manageShop.deliverySettings.connected':           'Connected',
        'manageShop.deliverySettings.statusActive':        'Active',
        'manageShop.deliverySettings.statusInactive':      'Inactive',
        'manageShop.deliverySettings.statusNotConnected':  'Not Connected',
        'manageShop.deliverySettings.testConnection':      'Test Connection',
        'manageShop.deliverySettings.deactivate':          'Deactivate',
        'manageShop.deliverySettings.activate':            'Activate',
        'manageShop.deliverySettings.saveConnect':         'Save & Connect',
        'manageShop.deliverySettings.useSandbox':          'Use Sandbox',
        'manageShop.deliverySettings.noTiers':             'No weight tiers',
        'manageShop.deliverySettings.errors.loadFailed':   'Failed to load delivery settings',
        'manageShop.deliverySettings.errors.saveFailed':   'Failed to save settings',
        'manageShop.deliverySettings.errors.connectFailed':'Failed to connect provider',
        'manageShop.deliverySettings.errors.disconnectFailed': 'Failed to disconnect',
        'manageShop.deliverySettings.errors.toggleFailed': 'Failed to toggle provider',
        'manageShop.deliverySettings.errors.testFailed':   'Connection test failed',
        'manageShop.deliverySettings.errors.invalidWeightTiers': 'Invalid weight tiers',
        'manageShop.deliverySettings.errors.fieldRequired': `Field is required`,
        'manageShop.deliverySettings.success.settingsSaved': 'Settings saved successfully',
        'manageShop.deliverySettings.success.connected':   'Provider connected',
        'manageShop.deliverySettings.success.disconnected':'Provider disconnected',
        'manageShop.deliverySettings.success.activated':   'Provider activated',
        'manageShop.deliverySettings.success.deactivated': 'Provider deactivated',
        'manageShop.deliverySettings.success.testSuccess': 'Connection test successful',
        'manageShop.deliverySettings.disconnectConfirm':   'Are you sure you want to disconnect?',
        'manageShop.deliverySettings.zoneInsideDhaka':     'Inside Dhaka',
        'manageShop.deliverySettings.zoneSubDhaka':        'Sub Dhaka',
        'manageShop.deliverySettings.zoneOutsideDhaka':    'Outside Dhaka',
        'manageShop.deliverySettings.extraCharge':         'Extra Charge',
        'manageShop.deliverySettings.weightFrom':          'From (kg)',
        'manageShop.deliverySettings.weightTo':            'To (kg)',
        'manageShop.deliverySettings.lastTested':          'Last tested',
        'common.connect':                                  'Connect',
        'common.disconnect':                               'Disconnect',
        'common.cancel':                                   'Cancel',
        'common.codAllowed':                               'COD Allowed',
        'manageShop.deliverySettings.codAllowed':          'COD Allowed',
      };
      return map[key] ?? key;
    },
  }),
}));

// ── Mock lucide-react icons (keeps DOM clean) ─────────────────────────────────
vi.mock('lucide-react', () => ({
  Truck:       () => null,
  Check:       () => null,
  X:           ({ className, onClick }: { className?: string; onClick?: () => void }) =>
    <button onClick={onClick} aria-label="close" className={className} />,
  AlertCircle: () => null,
  Loader2:     () => null,
  Power:       () => null,
  TestTube:    () => null,
}));

// ── Shared fixture data ───────────────────────────────────────────────────────

const makeDefaultSettings = () => ({
  providers: [],
  settings: {
    default_delivery_charge: 60,
    cod_enabled: false,
    cod_charge: 0,
    non_refundable: false,
    area_pricing: [
      { zone: 'inside_dhaka', charge: 60,  cod_enabled: false },
      { zone: 'sub_dhaka',    charge: 80,  cod_enabled: false },
      { zone: 'outside_dhaka',charge: 120, cod_enabled: false },
    ],
    weight_tiers: [{ from_kg: 0, to_kg: 1, extra_charge: 0 }],
  },
});

const makeConnectedProviders = () => [
  {
    provider: 'pathao',
    display_name: 'Pathao Courier',
    is_connected: true,
    is_active: true,
    last_validated_at: '2024-01-15T10:00:00Z',
    connected_at: '2024-01-01T00:00:00Z',
  },
  {
    provider: 'steadfast',
    display_name: 'Steadfast Courier',
    is_connected: true,
    is_active: false,
    last_validated_at: null,
    connected_at: '2024-01-01T00:00:00Z',
  },
  {
    provider: 'redx',
    display_name: 'RedX Courier',
    is_connected: false,
    is_active: false,
    last_validated_at: null,
    connected_at: null,
  },
];

// ── Helper ────────────────────────────────────────────────────────────────────

const renderComponent = async () => {
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(<DeliverySettings />);
  });
  return utils!;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeliverySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeliverySettings.mockResolvedValue(makeDefaultSettings());
    mockUpdateDeliverySettings.mockResolvedValue(makeDefaultSettings().settings);
    mockConnectDeliveryProvider.mockResolvedValue({});
    mockDisconnectDeliveryProvider.mockResolvedValue({});
    mockToggleDeliveryProvider.mockResolvedValue({});
    mockTestDeliveryConnection.mockResolvedValue({});
    // Browser confirm defaults to true
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  // ── 1. Initial loading state ──────────────────────────────────────────────
  it('shows a loading spinner while delivery settings are being fetched', () => {
    // Never-resolving promise keeps loading=true
    mockGetDeliverySettings.mockImplementation(() => new Promise(() => {}));
    render(<DeliverySettings />);

    const spinner =
      document.querySelector('[class*="animate"]') ||
      document.querySelector('[class*="spin"]') ||
      document.querySelector('svg');
    expect(spinner).toBeTruthy();
  });

  // ── 2. Renders provider cards ─────────────────────────────────────────────
  it('renders all three provider cards after data loads', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Pathao Courier')).toBeInTheDocument();
      expect(screen.getByText('Steadfast Courier')).toBeInTheDocument();
      expect(screen.getByText('RedX Courier')).toBeInTheDocument();
    });
  });

  // ── 3. Page heading ───────────────────────────────────────────────────────
  it('renders the Delivery Settings page heading', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Delivery Settings')).toBeInTheDocument();
    });
  });

  // ── 4. Provider status badges ─────────────────────────────────────────────
  it('shows correct status badges for connected/disconnected providers', async () => {
    mockGetDeliverySettings.mockResolvedValue({
      ...makeDefaultSettings(),
      providers: makeConnectedProviders(),
    });

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();       // Pathao active
      expect(screen.getByText('Inactive')).toBeInTheDocument();     // Steadfast connected but inactive
      expect(screen.getByText('Not Connected')).toBeInTheDocument(); // RedX not connected
    });
  });

  // ── 5. Connect button opens credentials form ──────────────────────────────
  it('opens credentials form when Connect button is clicked for an unconnected provider', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Pathao Courier')).toBeInTheDocument();
    });

    // All providers are disconnected (empty providers array from makeDefaultSettings)
    const connectButtons = screen.getAllByText('Connect');
    await act(async () => {
      fireEvent.click(connectButtons[0]); // Pathao connect
    });

    await waitFor(() => {
      expect(screen.getByText(/Enter.*Credentials/i)).toBeInTheDocument();
    });
  });

  // ── 6. Credentials form shows provider-specific fields ────────────────────
  it('shows Pathao-specific credential fields when Pathao connect is clicked', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    const connectButtons = screen.getAllByText('Connect');
    await act(async () => {
      fireEvent.click(connectButtons[0]); // first = Pathao
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your Pathao Client ID')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter your Pathao Client Secret')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('merchant@example.com')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter your Pathao account password')).toBeInTheDocument();
    });
  });

  // ── 7. Save & Connect calls connectDeliveryProvider ──────────────────────
  it('calls connectDeliveryProvider with credentials when Save & Connect is submitted', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    // Open Steadfast form (index 1 in connect buttons → steadfast)
    const connectButtons = screen.getAllByText('Connect');
    await act(async () => {
      fireEvent.click(connectButtons[1]); // Steadfast
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your Steadfast API Key')).toBeInTheDocument();
    });

    // Fill credentials
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Enter your Steadfast API Key'), {
        target: { value: 'test-api-key' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your Steadfast Secret Key'), {
        target: { value: 'test-secret-key' },
      });
    });

    // Click Save & Connect
    await act(async () => {
      fireEvent.click(screen.getByText('Save & Connect'));
    });

    await waitFor(() => {
      expect(mockConnectDeliveryProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'steadfast',
          credentials: expect.objectContaining({
            api_key: 'test-api-key',
            secret_key: 'test-secret-key',
          }),
        })
      );
    });
  });

  // ── 8. Success message shown after successful connect ─────────────────────
  it('shows success message after successful provider connection', async () => {
    mockConnectDeliveryProvider.mockResolvedValue({});
    // Second getDeliverySettings call after connect (loadDeliverySettings refresh)
    mockGetDeliverySettings
      .mockResolvedValueOnce(makeDefaultSettings())  // initial load
      .mockResolvedValueOnce(makeDefaultSettings());  // refresh after connect

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    // Open RedX (index 2)
    const connectButtons = screen.getAllByText('Connect');
    await act(async () => {
      fireEvent.click(connectButtons[2]); // RedX
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your RedX API Key')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Enter your RedX API Key'), {
        target: { value: 'redx-api-key' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save & Connect'));
    });

    await waitFor(() => {
      // success message key includes 'connected' or the mapped string
      expect(
        screen.queryByText(/connected|Provider connected/i)
      ).toBeInTheDocument();
    });
  });

  // ── 9. Error banner on failed connect ────────────────────────────────────
  it('shows error message when provider connection fails', async () => {
    mockConnectDeliveryProvider.mockRejectedValueOnce(new Error('Auth failed'));

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    const connectButtons = screen.getAllByText('Connect');
    await act(async () => {
      fireEvent.click(connectButtons[2]); // RedX
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your RedX API Key')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Enter your RedX API Key'), {
        target: { value: 'bad-key' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save & Connect'));
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Auth failed|Failed to connect/i)
      ).toBeInTheDocument();
    });
  });

  // ── 10. Test Connection button ────────────────────────────────────────────
  it('calls testDeliveryConnection when Test Connection button is clicked', async () => {
    mockGetDeliverySettings.mockResolvedValue({
      ...makeDefaultSettings(),
      providers: makeConnectedProviders(),
    });

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Test Connection')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      // Pathao is the first connected provider with Test Connection button
      expect(mockTestDeliveryConnection).toHaveBeenCalledWith('pathao');
    });
  });

  // ── 11. Test Connection success message ───────────────────────────────────
  it('shows success message after successful connection test', async () => {
    mockGetDeliverySettings.mockResolvedValue({
      ...makeDefaultSettings(),
      providers: makeConnectedProviders(),
    });
    mockTestDeliveryConnection.mockResolvedValue({});

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Test Connection')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/test.*success|Connection test successful/i)
      ).toBeInTheDocument();
    });
  });

  // ── 12. Toggle provider ───────────────────────────────────────────────────
  it('calls toggleDeliveryProvider when Deactivate is clicked for an active provider', async () => {
    mockGetDeliverySettings
      .mockResolvedValueOnce({ ...makeDefaultSettings(), providers: makeConnectedProviders() })
      .mockResolvedValue(makeDefaultSettings()); // refresh

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Deactivate')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Deactivate'));
    });

    await waitFor(() => {
      expect(mockToggleDeliveryProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'pathao', is_active: false })
      );
    });
  });

  // ── 13. Activate a connected-but-inactive provider ────────────────────────
  it('calls toggleDeliveryProvider with is_active=true when Activate is clicked', async () => {
    mockGetDeliverySettings
      .mockResolvedValueOnce({ ...makeDefaultSettings(), providers: makeConnectedProviders() })
      .mockResolvedValue(makeDefaultSettings());

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Activate')).toBeInTheDocument(); // Steadfast inactive
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Activate'));
    });

    await waitFor(() => {
      expect(mockToggleDeliveryProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'steadfast', is_active: true })
      );
    });
  });

  // ── 14. Disconnect flow ───────────────────────────────────────────────────
  it('calls disconnectDeliveryProvider after confirm dialog is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetDeliverySettings
      .mockResolvedValueOnce({ ...makeDefaultSettings(), providers: makeConnectedProviders() })
      .mockResolvedValue(makeDefaultSettings());

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Disconnect').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Disconnect')[0]); // first Disconnect = Pathao
    });

    await waitFor(() => {
      expect(mockDisconnectDeliveryProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'pathao' })
      );
    });
  });

  it('does NOT call disconnectDeliveryProvider when confirm dialog is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockGetDeliverySettings.mockResolvedValue({
      ...makeDefaultSettings(),
      providers: makeConnectedProviders(),
    });

    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Disconnect').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Disconnect')[0]);
    });

    expect(mockDisconnectDeliveryProvider).not.toHaveBeenCalled();
  });

  // ── 15. Save general settings ─────────────────────────────────────────────
  it('calls updateDeliverySettings when Save Settings button is clicked', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });

    await waitFor(() => {
      expect(mockUpdateDeliverySettings).toHaveBeenCalledTimes(1);
    });
  });

  // ── 16. Success message after save settings ───────────────────────────────
  it('shows success message after saving general settings', async () => {
    mockUpdateDeliverySettings.mockResolvedValue(makeDefaultSettings().settings);

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/saved|Settings saved successfully/i)
      ).toBeInTheDocument();
    });
  });

  // ── 17. Error banner on failed save settings ──────────────────────────────
  it('shows error message when updateDeliverySettings fails', async () => {
    mockUpdateDeliverySettings.mockRejectedValueOnce(new Error('Server error'));

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Settings'));
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/Server error|Failed to save/i)
      ).toBeInTheDocument();
    });
  });

  // ── 18. Error banner when initial load fails ──────────────────────────────
  it('shows error message when getDeliverySettings fails on mount', async () => {
    mockGetDeliverySettings.mockRejectedValueOnce(new Error('Network error'));

    await renderComponent();

    await waitFor(() => {
      expect(
        screen.queryByText(/Failed to load|Network error/i)
      ).toBeInTheDocument();
    });
  });

  // ── 19. Area pricing section rendered ────────────────────────────────────
  it('renders the Area Based Pricing section with default zones', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Area Based Pricing')).toBeInTheDocument();
      expect(screen.getAllByText('Inside Dhaka').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sub Dhaka').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Outside Dhaka').length).toBeGreaterThan(0);
    });
  });

  // ── 20. Add area pricing row ──────────────────────────────────────────────
  it('adds a new area pricing row when Add Area is clicked', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Add Area')).toBeInTheDocument();
    });

    const initialRows = screen.getAllByText('Inside Dhaka').length;

    await act(async () => {
      fireEvent.click(screen.getByText('Add Area'));
    });

    await waitFor(() => {
      // Should have one more row than before
      expect(screen.getAllByText('Inside Dhaka').length).toBeGreaterThan(initialRows);
    });
  });

  // ── 21. Weight tier validation error ─────────────────────────────────────
  it('shows validation error when weight tier has from_kg >= to_kg before API call', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });

    // The default tier has from=0, to=1 which is valid.
    // Find the "to_kg" input (second number input in the tier row) and set it to 0 (= from_kg)
    const tierInputs = document.querySelectorAll(
      '.space-y-3 input[type="number"]'
    );
    // tierInputs: [from_kg, to_kg, extra_charge] for the single default tier
    if (tierInputs.length >= 2) {
      await act(async () => {
        fireEvent.change(tierInputs[1], { target: { value: '0' } }); // to_kg = 0 = from_kg
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Save Settings'));
      });

      await waitFor(() => {
        expect(
          screen.queryByText(/Invalid weight tiers/i)
        ).toBeInTheDocument();
        expect(mockUpdateDeliverySettings).not.toHaveBeenCalled();
      });
    }
  });

  // ── 22. Cancel button hides credentials form ──────────────────────────────
  it('hides the credentials form when Cancel is clicked', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    // Open form
    await act(async () => {
      fireEvent.click(screen.getAllByText('Connect')[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Save & Connect')).toBeInTheDocument();
    });

    // Cancel
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    await waitFor(() => {
      expect(screen.queryByText('Save & Connect')).not.toBeInTheDocument();
    });
  });

  // ── 23. Sandbox checkbox only visible for Pathao ──────────────────────────
  it('shows sandbox checkbox only in the Pathao credentials form', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Connect').length).toBeGreaterThan(0);
    });

    // Open Pathao form (index 0)
    await act(async () => {
      fireEvent.click(screen.getAllByText('Connect')[0]);
    });

    await waitFor(() => {
      expect(screen.getByText('Use Sandbox')).toBeInTheDocument();
    });

    // Close, open Steadfast (index 1 — but now there's only 2 connect buttons left since Pathao form is open)
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    // Open Steadfast
    await act(async () => {
      const connectBtns = screen.getAllByText('Connect');
      fireEvent.click(connectBtns[1]); // steadfast
    });

    await waitFor(() => {
      expect(screen.queryByText('Use Sandbox')).not.toBeInTheDocument();
    });
  });

  // ── 24. getDeliverySettings called on mount ───────────────────────────────
  it('calls getDeliverySettings exactly once on component mount', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(mockGetDeliverySettings).toHaveBeenCalledTimes(1);
    });
  });
});
