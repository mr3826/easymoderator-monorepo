import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BusinessInfoForm from './BusinessInfoForm';
import type { BusinessInfo } from '../lib/knowledgeTypes';

const mockT = (key: string) => key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

describe('BusinessInfoForm', () => {
  const mockOnSave = vi.fn();
  const defaultProps = {
    initialData: null,
    onSave: mockOnSave,
    isLoading: false,
  };

  beforeEach(() => {
    mockOnSave.mockClear();
  });

  it('renders loading state', () => {
    render(<BusinessInfoForm {...defaultProps} isLoading={true} />);
    expect(screen.getByText('manageShop.businessInfo.loading')).toBeInTheDocument();
  });

  it('renders form fields with empty initial data', () => {
    render(<BusinessInfoForm {...defaultProps} />);
    
    expect(screen.getByLabelText(/shopName/i)).toHaveValue('');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('');
    expect(screen.getByLabelText(/address/i)).toHaveValue('');
    expect(screen.getByLabelText(/openingHours/i)).toHaveValue('');
    expect(screen.getByLabelText(/additionalInfo/i)).toHaveValue('');
  });

  it('renders form fields with initial data', () => {
    const initialData: BusinessInfo = {
      shopName: 'Test Shop',
      phone: '01712345678',
      address: 'Dhaka, Bangladesh',
      openingHours: '9am-9pm',
      additionalInfo: 'Owner says exchange is allowed within 3 days.',
      deliveryAreas: ['Dhaka', 'Chittagong'],
      paymentMethods: ['bKash', 'COD'],
    };

    render(<BusinessInfoForm {...defaultProps} initialData={initialData} />);
    
    expect(screen.getByDisplayValue('Test Shop')).toBeInTheDocument();
    expect(screen.getByDisplayValue('01712345678')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dhaka, Bangladesh')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Owner says exchange is allowed within 3 days.')).toBeInTheDocument();
  });

  it('updates shop name on input change', async () => {
    render(<BusinessInfoForm {...defaultProps} />);
    const shopNameInput = screen.getByLabelText(/shopName/i);
    
    await userEvent.type(shopNameInput, 'New Shop Name');
    expect(shopNameInput).toHaveValue('New Shop Name');
  });

  it('disables save button when no changes made', () => {
    render(<BusinessInfoForm {...defaultProps} />);
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when data changes', async () => {
    render(<BusinessInfoForm {...defaultProps} />);
    const shopNameInput = screen.getByLabelText(/shopName/i);
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    
    await userEvent.type(shopNameInput, 'New Name');
    expect(saveButton).not.toBeDisabled();
  });

  it('calls onSave with correct data when form submitted', async () => {
    mockOnSave.mockResolvedValue({ businessInfo: { shopName: 'Saved Shop' } });
    
    render(<BusinessInfoForm {...defaultProps} />);
    
    const shopNameInput = screen.getByLabelText(/shopName/i);
    await userEvent.type(shopNameInput, 'Test Shop');
    
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        shopName: 'Test Shop',
        address: '',
        phone: '',
        openingHours: '',
        additionalInfo: '',
      }));
    });
  });

  it('sends additional owner info when edited', async () => {
    mockOnSave.mockResolvedValue({ businessInfo: {} });

    render(<BusinessInfoForm {...defaultProps} />);

    const additionalInfoInput = screen.getByLabelText(/additionalInfo/i);
    await userEvent.type(additionalInfoInput, 'Exchange only with unboxing video.');

    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(expect.objectContaining({
        additionalInfo: 'Exchange only with unboxing video.',
      }));
    });
  });

  it('displays success notice after successful save', async () => {
    mockOnSave.mockResolvedValue({ businessInfo: {} });
    
    render(<BusinessInfoForm {...defaultProps} />);
    
    const shopNameInput = screen.getByLabelText(/shopName/i);
    await userEvent.type(shopNameInput, 'Test');
    
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText(/successMsg/i)).toBeInTheDocument();
    });
  });

  it('displays error notice when save fails', async () => {
    mockOnSave.mockRejectedValue({
      response: { data: { error: { message: 'Save failed' } } },
    });
    
    render(<BusinessInfoForm {...defaultProps} />);
    
    const shopNameInput = screen.getByLabelText(/shopName/i);
    await userEvent.type(shopNameInput, 'Test');
    
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });
  });

  it('shows saving state during submission', async () => {
    mockOnSave.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<BusinessInfoForm {...defaultProps} />);
    
    const shopNameInput = screen.getByLabelText(/shopName/i);
    await userEvent.type(shopNameInput, 'Test');
    
    const saveButton = screen.getByRole('button', { name: /saveChanges/i });
    fireEvent.click(saveButton);
    
    await waitFor(() => {
      expect(screen.getByText(/saving/i)).toBeInTheDocument();
    });
  });

  it('preserves initial data structure when partially updating', async () => {
    const initialData: BusinessInfo = {
      shopName: 'Original',
      phone: '01712345678',
      address: 'Dhaka',
      openingHours: '9-5',
      additionalInfo: 'Existing owner note',
      deliveryAreas: ['Zone A'],
      paymentMethods: ['COD'],
    };

    render(<BusinessInfoForm {...defaultProps} initialData={initialData} />);
    
    // Only change shop name
    const shopNameInput = screen.getByDisplayValue('Original');
    await userEvent.clear(shopNameInput);
    await userEvent.type(shopNameInput, 'Updated');
    
    expect(screen.getByDisplayValue('Updated')).toBeInTheDocument();
    expect(screen.getByDisplayValue('01712345678')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dhaka')).toBeInTheDocument();
  });
});
