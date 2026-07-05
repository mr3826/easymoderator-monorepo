import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AISettingsForm from './AISettingsForm';
import type { ShopAISettings } from '@/api/types/dashboard';

// Resolve real English from en.json so assertions verify the actual (en-default)
// UI copy after i18n-ization, with {{var}} interpolation support.
vi.mock('react-i18next', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, any>;
  const t = (key: string, opts?: any) => {
    const v = key.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), en);
    if (typeof v !== 'string') return typeof opts === 'string' ? opts : key;
    if (opts && typeof opts === 'object') {
      return Object.entries(opts).reduce(
        (s, [k, val]) => s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(val)),
        v,
      );
    }
    return v;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: () => Promise.resolve() } }) };
});

describe('AISettingsForm', () => {
  const mockOnSave = vi.fn();
  const defaultProps = {
    initialData: null,
    onSave: mockOnSave,
  };

  const defaultSettings: ShopAISettings = {
    automation_mode: 'DRAFT',
    confidence_threshold: 60,
    auto_reply_enabled: false,
    max_auto_order_value: 5000,
    ask_email: false,
    primary_language: 'mixed',
    required_fields: {
      customer_name: true,
      mobile_number: true,
      delivery_address: true,
      payment_method: true,
      email_address: false,
      special_instructions: false,
    },
    handoff_settings: {
      trigger_keywords: ['complain', 'problem', 'issue'],
      notification_channel: 'in_app',
      cooldown_minutes: 30,
    },
  };

  beforeEach(() => {
    mockOnSave.mockClear();
  });

  it('renders with default settings', () => {
    render(<AISettingsForm {...defaultProps} />);
    
    expect(screen.getByText('Reply Settings')).toBeInTheDocument();
    expect(screen.getByText('Choose when EasyModerator drafts, sends, or pauses replies.')).toBeInTheDocument();
  });

  it('renders automation mode options', () => {
    render(<AISettingsForm {...defaultProps} />);
    
    expect(screen.getByText('AUTO')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('MANUAL')).toBeInTheDocument();
  });

  it('marks Draft as the default active automation mode', () => {
    render(<AISettingsForm {...defaultProps} />);

    const draftButton = screen.getByText('Review first (Recommended)').closest('button');
    expect(draftButton).not.toBeNull();
    expect(draftButton!.className).toContain('border-green-500');
  });

  it('selects automation mode on click', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const autoButton = screen.getByText('Send automatically').closest('button');
    expect(autoButton).not.toBeNull();
    fireEvent.click(autoButton!);
    
    // Check that the button has the active styling class
    expect(autoButton!.className).toContain('border-green-500');
  });

  it('renders language options', () => {
    render(<AISettingsForm {...defaultProps} />);
    
    expect(screen.getByText('mixed')).toBeInTheDocument();
    expect(screen.getByText('bn')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
  });

  it('selects primary language on click', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const enButton = screen.getByRole('button', { name: /^en\b/i });
    fireEvent.click(enButton);
    
    expect(enButton.className).toContain('border-blue-500');
  });

  it('updates confidence threshold on slider change', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '80' } });
    
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('updates max auto order value on input change', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    expect(maxOrderInput).toHaveValue(10000);
  });

  it('does not render a redundant auto-reply toggle', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);

    expect(screen.queryByText('Automatic replies enabled')).not.toBeInTheDocument();
  });

  it('toggles required fields checkboxes', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const customerNameCheckbox = screen.getByLabelText(/customer name/i);
    expect(customerNameCheckbox).toBeChecked();
    
    fireEvent.click(customerNameCheckbox);
    expect(customerNameCheckbox).not.toBeChecked();
  });

  it('expands handoff settings section on click', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const handoffButton = screen.getByRole('button', { name: /When We Should Alert You/i });
    fireEvent.click(handoffButton);
    
    expect(screen.getByLabelText(/Alert channel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cooldown/i)).toBeInTheDocument();
  });

  it('changes notification channel in handoff settings to Telegram', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const handoffButton = screen.getByRole('button', { name: /When We Should Alert You/i });
    fireEvent.click(handoffButton);
    
    const channelSelect = screen.getByLabelText(/Alert channel/i);
    fireEvent.change(channelSelect, { target: { value: 'telegram' } });
    
    expect(channelSelect).toHaveValue('telegram');
  });

  it('adds alert keywords in handoff settings', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const handoffButton = screen.getByRole('button', { name: /When We Should Alert You/i });
    fireEvent.click(handoffButton);
    
    // Find the alert keywords input (second tag input in the form)
    const inputs = screen.getAllByPlaceholderText(/e\.g\./i);
    const keywordInput = inputs[inputs.length - 1]; // Last one is the handoff keywords
    
    await userEvent.type(keywordInput, 'refund');
    
    const addButtons = screen.getAllByRole('button', { name: '' });
    const addButton = addButtons[addButtons.length - 1];
    fireEvent.click(addButton);
    
    await waitFor(() => {
      expect(screen.getByText('refund')).toBeInTheDocument();
    });
  });

  it('disables save button when no changes made', () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when settings change', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('calls onSave with correct data', async () => {
    mockOnSave.mockResolvedValue({});
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        max_auto_order_value: 10000,
        automation_mode: 'DRAFT',
        auto_reply_enabled: false,
      }));
    });
  });

  it('derives auto_reply_enabled from automation mode when saving', async () => {
    mockOnSave.mockResolvedValue({});

    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);

    const autoButton = screen.getByText('Send automatically').closest('button');
    expect(autoButton).not.toBeNull();
    fireEvent.click(autoButton!);

    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        automation_mode: 'AUTO',
        auto_reply_enabled: true,
      }));
    });
  });

  it('shows success notice after save', async () => {
    mockOnSave.mockResolvedValue({});
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('Reply settings saved.')).toBeInTheDocument();
    });
  });

  it('shows error notice when save fails', async () => {
    mockOnSave.mockRejectedValue({
      response: { data: { error: { message: 'Failed to save' } } },
    });
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save Reply Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to save')).toBeInTheDocument();
    });
  });

  it('merges initial data with defaults correctly', () => {
    const partialData: Partial<ShopAISettings> = {
      automation_mode: 'AI_ACTIVE',
      confidence_threshold: 80,
    };

    render(<AISettingsForm {...defaultProps} initialData={partialData} />);
    
    // Check that provided values are used
    expect(screen.getByText('80%')).toBeInTheDocument();
    
    // Check that defaults are merged for missing values
    const maxOrderInput = screen.getByLabelText(/Maximum automatic order value/i);
    expect(maxOrderInput).toHaveValue(5000);

    const autoButton = screen.getByText('Send automatically').closest('button');
    expect(autoButton).not.toBeNull();
    expect(autoButton!.className).toContain('border-green-500');
  });

  it('deep merges required_fields correctly', async () => {
    const partialData: Partial<ShopAISettings> = {
      required_fields: {
        customer_name: false,
        mobile_number: true,
        delivery_address: true,
        payment_method: true,
        email_address: true,
        special_instructions: false,
      },
    };

    render(<AISettingsForm {...defaultProps} initialData={partialData} />);
    
    const customerNameCheckbox = screen.getByLabelText(/customer name/i);
    expect(customerNameCheckbox).not.toBeChecked();
    
    const emailCheckbox = screen.getByLabelText(/email address/i);
    expect(emailCheckbox).toBeChecked();
  });

  it('updates cooldown minutes in handoff settings', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const handoffButton = screen.getByRole('button', { name: /When We Should Alert You/i });
    fireEvent.click(handoffButton);
    
    const cooldownInput = screen.getByLabelText(/Cooldown/i);
    await userEvent.clear(cooldownInput);
    await userEvent.type(cooldownInput, '60');
    
    expect(cooldownInput).toHaveValue(60);
  });
});
