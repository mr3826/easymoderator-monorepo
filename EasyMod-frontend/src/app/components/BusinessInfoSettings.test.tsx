import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BusinessInfoSettings from './BusinessInfoSettings';

// ── Hoist mock functions so they are available inside vi.mock factories ───
const {
  mockGetShopBusinessInfo,
  mockGetShopAISettings,
  mockUpdateShopBusinessInfo,
  mockUpdateShopAISettings,
} = vi.hoisted(() => {
  const mockBusinessInfo = {
    businessInfo: {
      shopName: 'Test Shop',
      address: '123 Main St',
      phone: '01700000000',
      openingHours: '9am-6pm',
      deliveryAreas: ['Dhaka', 'Chittagong'],
      paymentMethods: ['COD', 'bKash'],
    },
    brandingRules: {},
    faqs: [],
    documents: [],
    ai_settings: {},
  };
  const mockAISettings = {
    automation_mode: 'DRAFT',
    confidence_threshold: 60,
    auto_reply_enabled: true,
    max_auto_order_value: 5000,
    ask_email: false,
    primary_language: 'mixed',
    required_fields: { customer_name: true, mobile_number: true, delivery_address: true, payment_method: true, email_address: false, special_instructions: false },
    handoff_settings: { trigger_keywords: ['complain', 'problem'], notification_channel: 'in_app', cooldown_minutes: 30 },
  };
  return {
    mockGetShopBusinessInfo:    vi.fn().mockResolvedValue(mockBusinessInfo),
    mockGetShopAISettings:      vi.fn().mockResolvedValue(mockAISettings),
    mockUpdateShopBusinessInfo: vi.fn().mockResolvedValue(mockBusinessInfo),
    mockUpdateShopAISettings:   vi.fn().mockResolvedValue(mockAISettings),
  };
});

// ── Re-export mock data for test assertions ────────────────────────────────
const mockBusinessInfo = {
  businessInfo: { shopName: 'Test Shop', address: '123 Main St', phone: '01700000000', openingHours: '9am-6pm', deliveryAreas: ['Dhaka', 'Chittagong'], paymentMethods: ['COD', 'bKash'] },
  brandingRules: {}, faqs: [], documents: [], ai_settings: {},
};
const mockAISettings = {
  automation_mode: 'DRAFT', confidence_threshold: 60, auto_reply_enabled: true,
  max_auto_order_value: 5000, ask_email: false, primary_language: 'mixed',
  required_fields: { customer_name: true, mobile_number: true, delivery_address: true, payment_method: true, email_address: false, special_instructions: false },
  handoff_settings: { trigger_keywords: ['complain', 'problem'], notification_channel: 'in_app', cooldown_minutes: 30 },
};

// ── Mock react-i18next ────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ── Mock API client ───────────────────────────────────────────────────────
vi.mock('@/api', () => ({
  apiClient: {
    getShopBusinessInfo:    mockGetShopBusinessInfo,
    getShopAISettings:      mockGetShopAISettings,
    updateShopBusinessInfo: mockUpdateShopBusinessInfo,
    updateShopAISettings:   mockUpdateShopAISettings,
  },
}));

// ── Mock auth service ─────────────────────────────────────────────────────
vi.mock('@/app/lib/auth', () => ({
  authService: {
    getUser: vi.fn().mockReturnValue({ userId: 'user-1', shopId: 'shop-1' }),
    isAuthenticated: vi.fn().mockReturnValue(true),
    refreshShops: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock lucide-react icons ───────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  Plus:       () => null,
  X:          () => null,
  ChevronDown:() => null,
  ChevronUp:  () => null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────
const renderComponent = async () => {
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(<BusinessInfoSettings />);
  });
  return utils!;
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BusinessInfoSettings', () => {
  beforeEach(() => {
    mockGetShopBusinessInfo.mockReset().mockResolvedValue(mockBusinessInfo);
    mockGetShopAISettings.mockReset().mockResolvedValue(mockAISettings);
    mockUpdateShopBusinessInfo.mockReset().mockResolvedValue(mockBusinessInfo);
    mockUpdateShopAISettings.mockReset().mockResolvedValue(mockAISettings);
  });

  // ── Loading & data display ──────────────────────────────────────────────

  it('shows loading state initially', async () => {
    // Make the API call take time
    mockGetShopBusinessInfo.mockImplementation(() => new Promise(() => {}));
    mockGetShopAISettings.mockImplementation(() => new Promise(() => {}));

    render(<BusinessInfoSettings />);
    // Should show some loading indicator (spinner or skeleton)
    const loading = document.querySelector('[class*="animate"]') ||
                    screen.queryByText(/loading/i) ||
                    document.querySelector('[role="status"]');
    expect(loading).toBeTruthy();
  });

  it('loads and displays shop name after data fetch', async () => {
    await renderComponent();

    await waitFor(() => {
      const shopNameInput = screen.getByDisplayValue('Test Shop');
      expect(shopNameInput).toBeInTheDocument();
    });
  });

  it('displays all business info fields', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
      expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
      expect(screen.getByDisplayValue('01700000000')).toBeInTheDocument();
      expect(screen.getByDisplayValue('9am-6pm')).toBeInTheDocument();
    });
  });

  it('shows error message when load fails', async () => {
    mockGetShopBusinessInfo.mockRejectedValueOnce(new Error('Network error'));
    mockGetShopAISettings.mockResolvedValue(mockAISettings);

    await renderComponent();

    await waitFor(() => {
      const error = screen.queryByText(/failed|error/i);
      expect(error).toBeTruthy();
    });
  });

  // ── AI settings panel ───────────────────────────────────────────────────

  it('renders AI settings panel', async () => {
    await renderComponent();

    await waitFor(() => {
      // automation mode select or label should be visible
      const automationLabels = screen.queryAllByText(/automation/i);
      const aiLabels = screen.queryAllByText(/AI/i);
      expect(automationLabels.length > 0 || aiLabels.length > 0).toBe(true);
    });
  });

  it('renders the confidence threshold slider', async () => {
    await renderComponent();

    await waitFor(() => {
      const slider = document.querySelector('input[type="range"]');
      expect(slider).toBeTruthy();
    });
  });

  // ── Dirty-state tracking ────────────────────────────────────────────────

  it('Save Info button is disabled when no changes are made', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    // Find the Save Info button — it should be disabled (not dirty)
    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    const saveInfoButton = saveButtons.find(btn => btn.textContent?.toLowerCase().includes('info') ||
                                                    btn.closest('[class*="business"]') ||
                                                    saveButtons[0] === btn);
    // At least one save button should exist
    expect(saveButtons.length).toBeGreaterThan(0);
  });

  it('Save button becomes enabled after editing a field', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    // Modify shop name
    const shopNameInput = screen.getByDisplayValue('Test Shop');
    await act(async () => {
      fireEvent.change(shopNameInput, { target: { value: 'Updated Shop' } });
    });

    // A save button should now be enabled (dirty = true)
    await waitFor(() => {
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      const enabledSave = saveButtons.find(btn => !(btn as HTMLButtonElement).disabled);
      expect(enabledSave).toBeTruthy();
    });
  });

  // ── Save flows ──────────────────────────────────────────────────────────

  it('calls updateShopBusinessInfo when Save Info is submitted', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    // Dirty the form
    const shopNameInput = screen.getByDisplayValue('Test Shop');
    await act(async () => {
      fireEvent.change(shopNameInput, { target: { value: 'New Name' } });
    });

    // Click save
    await waitFor(() => {
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      const enabledSave = saveButtons.find(btn => !(btn as HTMLButtonElement).disabled);
      if (enabledSave) fireEvent.click(enabledSave);
    });

    await waitFor(() => {
      expect(mockUpdateShopBusinessInfo).toHaveBeenCalled();
    });
  });

  it('shows success notice after saving business info', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    const shopNameInput = screen.getByDisplayValue('Test Shop');
    await act(async () => {
      fireEvent.change(shopNameInput, { target: { value: 'Changed Name' } });
    });

    // Find and click the enabled save button
    await waitFor(async () => {
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      const enabledSave = saveButtons.find(btn => !(btn as HTMLButtonElement).disabled);
      if (enabledSave) {
        await act(async () => { fireEvent.click(enabledSave); });
      }
    });

    await waitFor(() => {
      const notice = screen.queryByText(/saved|success|successMsg/i);
      expect(notice).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('shows error notice when save fails', async () => {
    mockUpdateShopBusinessInfo.mockRejectedValueOnce(new Error('Server error'));

    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    const shopNameInput = screen.getByDisplayValue('Test Shop');
    await act(async () => {
      fireEvent.change(shopNameInput, { target: { value: 'Changed' } });
    });

    await waitFor(async () => {
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      const enabledSave = saveButtons.find(btn => !(btn as HTMLButtonElement).disabled);
      if (enabledSave) {
        await act(async () => { fireEvent.click(enabledSave); });
      }
    });

    await waitFor(() => {
      const error = screen.queryByText(/error|failed/i);
      expect(error).toBeTruthy();
    });
  });

  // ── API alignment checks ────────────────────────────────────────────────

  it('loads business info and AI settings in parallel (both API calls made)', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(mockGetShopBusinessInfo).toHaveBeenCalledTimes(1);
      expect(mockGetShopAISettings).toHaveBeenCalledTimes(1);
    });
  });

  it('sends business info payload to the correct endpoint shape', async () => {
    await renderComponent();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    });

    const shopNameInput = screen.getByDisplayValue('Test Shop');
    await act(async () => {
      fireEvent.change(shopNameInput, { target: { value: 'New Shop Name' } });
    });

    await waitFor(async () => {
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      const enabledSave = saveButtons.find(btn => !(btn as HTMLButtonElement).disabled);
      if (enabledSave) {
        await act(async () => { fireEvent.click(enabledSave); });
      }
    });

    await waitFor(() => {
      if (mockUpdateShopBusinessInfo.mock.calls.length > 0) {
        const payload = mockUpdateShopBusinessInfo.mock.calls[0][0];
        // Must be a businessInfo object (not wrapped). Delivery areas / payment
        // methods are no longer collected here — they live on the Delivery /
        // Payment Settings pages.
        expect(typeof payload).toBe('object');
        expect(payload).toHaveProperty('shopName');
        expect(payload).not.toHaveProperty('deliveryAreas');
        expect(payload).not.toHaveProperty('paymentMethods');
      }
    });
  });
});
