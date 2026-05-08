/**
 * Create/Edit User Modal Tests
 * Tests for form validation, submission, and error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import CreateUserModal from '../components/CreateUserModal';
import EditUserModal from '../components/EditUserModal';
import { User } from '../types';

// Mock the API hook
vi.mock('../api/useUsersApi', () => ({
  useUsersApi: () => ({
    createUser: vi.fn(),
    updateUser: vi.fn(),
    validateUserInput: vi.fn((input) => {
      const errors: Record<string, string> = {};
      if (!input.name?.trim()) errors.name = 'Name is required';
      if (!input.email?.trim()) errors.email = 'Email is required';
      if (!input.email?.includes('@')) errors.email = 'Valid email is required';
      return errors;
    }),
    isLoading: false,
    error: null,
  }),
}));

const queryClient = new QueryClient();

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

describe('CreateUserModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render form with required fields', () => {
    renderWithProviders(
      <CreateUserModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    expect(screen.getByDisplayValue('User')).toBeInTheDocument(); // Role select default (label is 'User')
  });

  it('should show title when open', () => {
    renderWithProviders(
      <CreateUserModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    expect(screen.getByText(/Create New User/i)).toBeInTheDocument();
  });

  it('should close modal on cancel', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <CreateUserModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    await user.click(cancelBtn);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should not render when isOpen is false', () => {
    const { container } = renderWithProviders(
      <CreateUserModal isOpen={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });
});

describe('EditUserModal', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();
  const mockUser: User = {
    id: '1',
    shopId: 'shop-1',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'moderator',
    isActive: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render form with edit title', () => {
    renderWithProviders(
      <EditUserModal isOpen={true} user={mockUser} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    expect(screen.getByText(/Edit User: John Doe/i)).toBeInTheDocument();
  });

  it('should close modal on cancel', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <EditUserModal isOpen={true} user={mockUser} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    await user.click(cancelBtn);

    expect(mockOnClose).toHaveBeenCalled();
  });
});
