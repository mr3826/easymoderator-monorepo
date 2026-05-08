import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AISettingsForm from './AISettingsForm';
import type { ShopAISettings } from '@/api/types/dashboard';

const mockT = (key: string) => key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

describe('AISettingsForm', () => {
  const mockOnSave = vi.fn();
  const defaultProps = {
    initialData: null,
    onSave: mockOnSave,
  };

  const defaultSettings: ShopAISettings = {
    automation_mode: 'DRAFT',
    confidence_threshold: 60,
    auto_reply_enabled: true,
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
    
    expect(screen.getByText('AI Behaviour Settings')).toBeInTheDocument();
    expect(screen.getByText('Control how the AI chatbot operates across all connected channels.')).toBeInTheDocument();
  });

  it('renders automation mode options', () => {
    render(<AISettingsForm {...defaultProps} />);
    
    expect(screen.getByText('AUTO')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    expect(screen.getByText('MANUAL')).toBeInTheDocument();
  });

  it('selects automation mode on click', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const autoButton = screen.getByRole('button', { name: /AUTO/i });
    fireEvent.click(autoButton);
    
    // Check that the button has the active styling class
    expect(autoButton.className).toContain('border-green-500');
  });

  it('renders language options', () => {
    render(<AISettingsForm {...defaultProps} />);
    
    expect(screen.getByText('mixed')).toBeInTheDocument();
    expect(screen.getByText('bn')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
  });

  it('selects primary language on click', async () => {
    render(<AISettingsForm {...defaultProps} />);
    
    const enButton = screen.getByRole('button', { name: /en/i });
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
    
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    expect(maxOrderInput).toHaveValue(10000);
  });

  it('toggles auto-reply enabled', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const toggle = screen.getByText('Auto-reply enabled').closest('label')?.querySelector('div');
    if (toggle) {
      fireEvent.click(toggle);
    }
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
    
    const handoffButton = screen.getByRole('button', { name: /Human Handoff Settings/i });
    fireEvent.click(handoffButton);
    
    expect(screen.getByLabelText(/Notification Channel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cooldown/i)).toBeInTheDocument();
  });

  it('changes notification channel in handoff settings', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const handoffButton = screen.getByRole('button', { name: /Human Handoff Settings/i });
    fireEvent.click(handoffButton);
    
    const channelSelect = screen.getByLabelText(/Notification Channel/i);
    fireEvent.change(channelSelect, { target: { value: 'email' } });
    
    expect(channelSelect).toHaveValue('email');
  });

  it('adds trigger keywords in handoff settings', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const handoffButton = screen.getByRole('button', { name: /Human Handoff Settings/i });
    fireEvent.click(handoffButton);
    
    // Find the trigger keywords input (second tag input in the form)
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
    const saveButton = screen.getByRole('button', { name: /Save AI Settings/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when settings change', async () => {
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save AI Settings/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('calls onSave with correct data', async () => {
    mockOnSave.mockResolvedValue({});
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save AI Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        max_auto_order_value: 10000,
        automation_mode: 'DRAFT',
      }));
    });
  });

  it('shows success notice after save', async () => {
    mockOnSave.mockResolvedValue({});
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save AI Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('AI settings saved.')).toBeInTheDocument();
    });
  });

  it('shows error notice when save fails', async () => {
    mockOnSave.mockRejectedValue({
      response: { data: { error: { message: 'Failed to save' } } },
    });
    
    render(<AISettingsForm {...defaultProps} initialData={defaultSettings} />);
    
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    await userEvent.clear(maxOrderInput);
    await userEvent.type(maxOrderInput, '10000');
    
    const saveButton = screen.getByRole('button', { name: /Save AI Settings/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to save')).toBeInTheDocument();
    });
  });

  it('merges initial data with defaults correctly', () => {
    const partialData: Partial<ShopAISettings> = {
      automation_mode: 'AUTO',
      confidence_threshold: 80,
    };

    render(<AISettingsForm {...defaultProps} initialData={partialData} />);
    
    // Check that provided values are used
    expect(screen.getByText('80%')).toBeInTheDocument();
    
    // Check that defaults are merged for missing values
    const maxOrderInput = screen.getByLabelText(/Max Auto-Order Value/i);
    expect(maxOrderInput).toHaveValue(5000);
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
    
    const handoffButton = screen.getByRole('button', { name: /Human Handoff Settings/i });
    fireEvent.click(handoffButton);
    
    const cooldownInput = screen.getByLabelText(/Cooldown/i);
    await userEvent.clear(cooldownInput);
    await userEvent.type(cooldownInput, '60');
    
    expect(cooldownInput).toHaveValue(60);
  });
});
