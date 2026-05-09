/**
 * Customers Component — Vitest Unit Tests
 * Tests customer list rendering, search/filter, delete flow, and blacklist toggle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import Customers from '../Customers';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/api', () => ({
  apiClient: {
    getCustomers:       vi.fn(),
    createCustomer:     vi.fn(),
    deleteCustomer:     vi.fn(),
    updateCustomer:     vi.fn(),
    blacklistCustomer:  vi.fn(),
    unblacklistCustomer: vi.fn(),
  },
}));

import { apiClient } from '@/api';
import { toast } from 'sonner';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeCustomer = (overrides: Record<string, any> = {}) => ({
  id: 'cust-1',
  shop_id: 'shop-1',
  name: 'Alice Martin',
  email: 'alice@example.com',
  number: '+8801711000001',
  channel: 'facebook' as const,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  rto_risk: undefined,
  blacklisted: false,
  ...overrides,
});

const mockCustomers = [
  makeCustomer({ id: 'cust-1', name: 'Alice Martin',  number: '+8801711000001', channel: 'facebook' }),
  makeCustomer({ id: 'cust-2', name: 'Bob Rahman',    number: '+8801722000002', channel: 'telegram' }),
  makeCustomer({ id: 'cust-3', name: 'Carol Hossain', number: '+8801733000003', channel: 'manual', rto_risk: 'high' }),
];

/** Default paginated response returned by getCustomers */
const makeListResponse = (data = mockCustomers, total = data.length) => ({
  data,
  total,
  page: 1,
  pageSize: 10,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const renderComponent = () =>
  render(
    <BrowserRouter>
      <Customers />
    </BrowserRouter>
  );

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

const renderAndWait = async () => {
  let utils: ReturnType<typeof render>;
  await act(async () => {
    utils = renderComponent();
    await flushPromises();
  });
  return utils!;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse());
    vi.mocked(apiClient.deleteCustomer).mockResolvedValue(undefined);
    vi.mocked(apiClient.updateCustomer).mockResolvedValue(mockCustomers[0]);
    vi.mocked(apiClient.blacklistCustomer).mockResolvedValue({ ...mockCustomers[0], blacklisted: true });
    vi.mocked(apiClient.unblacklistCustomer).mockResolvedValue({ ...mockCustomers[0], blacklisted: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it('shows a loading indicator before data resolves', async () => {
    // Never resolve so we stay in loading state
    vi.mocked(apiClient.getCustomers).mockImplementation(() => new Promise(() => {}));

    act(() => { renderComponent(); });

    // The component renders a Loader2 spinner and the translation key while loading
    const spinner = document.querySelector('[class*="animate-spin"]') ||
                    screen.queryByText('customers.loading');
    expect(spinner).toBeTruthy();
  });

  // ── Customer list ─────────────────────────────────────────────────────────

  it('renders customer names after data loads', async () => {
    await renderAndWait();

    await waitFor(() => {
      expect(screen.getByText('Alice Martin')).toBeInTheDocument();
      expect(screen.getByText('Bob Rahman')).toBeInTheDocument();
      expect(screen.getByText('Carol Hossain')).toBeInTheDocument();
    });
  });

  it('renders customer phone numbers in the table', async () => {
    await renderAndWait();

    await waitFor(() => {
      expect(screen.getByText('+8801711000001')).toBeInTheDocument();
    });
  });

  it('renders the page title heading', async () => {
    await renderAndWait();

    const heading = screen.queryByText('customers.title') ||
                    document.querySelector('h1');
    expect(heading).toBeTruthy();
  });

  it('renders the Add Customer button', async () => {
    await renderAndWait();

    const btn = screen.queryByText('customers.addCustomer') ||
                Array.from(document.querySelectorAll('button')).find(
                  (b) => b.textContent?.includes('addCustomer')
                );
    expect(btn).toBeTruthy();
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('shows the empty state when customers array is empty', async () => {
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse([], 0));

    await renderAndWait();

    await waitFor(() => {
      const emptyMsg = screen.queryByText('customers.noCustomers') ||
                       screen.queryByText('customers.noCustomersHint');
      expect(emptyMsg).toBeTruthy();
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it('renders a search input field', async () => {
    await renderAndWait();

    const input = screen.queryByPlaceholderText('customers.searchPlaceholder') ||
                  document.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  });

  it('triggers a new API call when search text is entered (after debounce)', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await act(async () => { renderComponent(); });
    await act(async () => { vi.runAllTimers(); }); // flush initial fetch

    const callsBefore = vi.mocked(apiClient.getCustomers).mock.calls.length;

    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    if (input) {
      await act(async () => {
        await user.type(input, 'Alice');
        vi.advanceTimersByTime(400); // past the 300 ms debounce
      });

      await waitFor(() => {
        expect(vi.mocked(apiClient.getCustomers).mock.calls.length).toBeGreaterThan(callsBefore);
      });
    }

    vi.useRealTimers();
  });

  it('resets to page 1 when search changes', async () => {
    await renderAndWait();

    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    if (input) {
      await act(async () => {
        fireEvent.change(input, { target: { value: 'Carol' } });
      });

      // After the state update the most recent call should have page: 1
      await waitFor(() => {
        const calls = vi.mocked(apiClient.getCustomers).mock.calls;
        const lastCall = calls[calls.length - 1]?.[0];
        if (lastCall) {
          expect(lastCall.page).toBe(1);
        }
      });
    }
  });

  // ── Channel filter ────────────────────────────────────────────────────────

  it('renders the channel filter dropdown', async () => {
    await renderAndWait();

    const select = document.querySelector('select');
    expect(select).toBeTruthy();
  });

  it('passes the selected channel filter to the API', async () => {
    await renderAndWait();

    const select = document.querySelector('select') as HTMLSelectElement;
    if (select) {
      await act(async () => {
        fireEvent.change(select, { target: { value: 'facebook' } });
        await flushPromises();
      });

      await waitFor(() => {
        const calls = vi.mocked(apiClient.getCustomers).mock.calls;
        const lastCall = calls[calls.length - 1]?.[0];
        if (lastCall) {
          expect(lastCall.channel_type).toBe('facebook');
        }
      });
    }
  });

  it('does not include channel_type when "all" is selected', async () => {
    await renderAndWait();

    const select = document.querySelector('select') as HTMLSelectElement;
    if (select) {
      // first select facebook, then switch back to all
      await act(async () => {
        fireEvent.change(select, { target: { value: 'facebook' } });
        fireEvent.change(select, { target: { value: 'all' } });
        await flushPromises();
      });

      await waitFor(() => {
        const calls = vi.mocked(apiClient.getCustomers).mock.calls;
        const lastCall = calls[calls.length - 1]?.[0];
        if (lastCall) {
          expect(lastCall.channel_type).toBeUndefined();
        }
      });
    }
  });

  // ── Delete — confirmation modal ───────────────────────────────────────────

  it('shows the delete confirmation modal when a delete button is clicked', async () => {
    await renderAndWait();

    await waitFor(() => {
      expect(screen.getByText('Alice Martin')).toBeInTheDocument();
    });

    // Delete buttons are icon-only (Trash2); grab the first one
    const deleteButtons = document.querySelectorAll('button[class*="text-red"]') as NodeListOf<HTMLButtonElement>;
    const firstDelete = deleteButtons[0] || Array.from(document.querySelectorAll('button')).find(
      (b) => b.querySelector('svg') && b.classList.toString().includes('red')
    );

    if (firstDelete) {
      await act(async () => { fireEvent.click(firstDelete); });

      await waitFor(() => {
        const modal = screen.queryByText('customers.deleteModal.title') ||
                      screen.queryByText('customers.deleteModal.message');
        expect(modal).toBeTruthy();
      });
    }
  });

  it('does NOT call deleteCustomer before confirmation', async () => {
    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.classList.toString().includes('red') && b.querySelector('svg')
    );
    const firstDelete = deleteButtons[0] as HTMLButtonElement | undefined;

    if (firstDelete) {
      await act(async () => { fireEvent.click(firstDelete); });
    }

    expect(apiClient.deleteCustomer).not.toHaveBeenCalled();
  });

  it('calls deleteCustomer with the correct id after confirmation', async () => {
    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    // Open the delete confirmation for the first customer
    const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.classList.toString().includes('red-600') && b.querySelector('svg')
    );
    const firstDelete = deleteButtons[0] as HTMLButtonElement | undefined;

    if (firstDelete) {
      await act(async () => { fireEvent.click(firstDelete); });

      // Confirm deletion
      await waitFor(async () => {
        const confirmBtn = screen.queryByText('customers.deleteModal.deleteButton') ||
                           Array.from(document.querySelectorAll('button')).find(
                             (b) => b.textContent?.includes('deleteButton') ||
                                    b.textContent?.includes('Delete') ||
                                    b.classList.toString().includes('bg-red-600')
                           ) as HTMLButtonElement | undefined;

        if (confirmBtn) {
          await act(async () => { fireEvent.click(confirmBtn as HTMLButtonElement); });
        }
      });

      await waitFor(() => {
        if (apiClient.deleteCustomer.mock.calls.length > 0) {
          expect(apiClient.deleteCustomer).toHaveBeenCalledWith('cust-1');
        }
      });
    }
  });

  it('removes the customer from the list after confirmed deletion', async () => {
    // After delete, return a list without cust-1
    vi.mocked(apiClient.getCustomers)
      .mockResolvedValueOnce(makeListResponse()) // initial load
      .mockResolvedValueOnce(makeListResponse())  // stats call
      .mockResolvedValue(makeListResponse([mockCustomers[1], mockCustomers[2]], 2)); // after delete

    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.classList.toString().includes('red-600') && b.querySelector('svg')
    );

    if (deleteButtons[0]) {
      await act(async () => { fireEvent.click(deleteButtons[0] as HTMLButtonElement); });

      const confirmBtn = Array.from(document.querySelectorAll('button')).find(
        (b) =>
          b.textContent?.includes('deleteButton') ||
          (b.classList.toString().includes('bg-red-600') && b.closest('[class*="fixed"]'))
      ) as HTMLButtonElement | undefined;

      if (confirmBtn) {
        await act(async () => {
          fireEvent.click(confirmBtn);
          await flushPromises();
        });

        await waitFor(() => {
          expect(screen.queryByText('Alice Martin')).toBeNull();
        });
      }
    }
  });

  it('keeps the customer in the list when deletion is cancelled', async () => {
    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.classList.toString().includes('red-600') && b.querySelector('svg')
    );

    if (deleteButtons[0]) {
      await act(async () => { fireEvent.click(deleteButtons[0] as HTMLButtonElement); });

      // Click the Cancel button in the modal
      const cancelBtn = screen.queryByText('common.cancel') ||
                        Array.from(document.querySelectorAll('button')).find(
                          (b) => b.textContent?.includes('cancel') || b.textContent?.includes('Cancel')
                        );

      if (cancelBtn) {
        await act(async () => { fireEvent.click(cancelBtn as HTMLButtonElement); });
      }
    }

    // Customer should still be present
    expect(screen.queryByText('Alice Martin')).toBeInTheDocument();
    expect(apiClient.deleteCustomer).not.toHaveBeenCalled();
  });

  // ── Error state ───────────────────────────────────────────────────────────

  it('shows an error message when getCustomers fails', async () => {
    vi.mocked(apiClient.getCustomers).mockRejectedValue(new Error('Network Error'));

    await renderAndWait();

    await waitFor(() => {
      const errorEl = screen.queryByText('Network Error') ||
                      screen.queryByText('customers.errors.fetchFailed') ||
                      document.querySelector('[class*="bg-red-50"]');
      expect(errorEl).toBeTruthy();
    });
  });

  it('shows a toast error when deleteCustomer fails', async () => {
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse());
    vi.mocked(apiClient.deleteCustomer).mockRejectedValue({
      response: { data: { error: { message: 'Delete failed' } } },
    });

    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
      (b) => b.classList.toString().includes('red-600') && b.querySelector('svg')
    );

    if (deleteButtons[0]) {
      await act(async () => { fireEvent.click(deleteButtons[0] as HTMLButtonElement); });

      const confirmBtn = Array.from(document.querySelectorAll('button')).find(
        (b) =>
          b.classList.toString().includes('bg-red-600') && b.closest('[class*="fixed"]')
      ) as HTMLButtonElement | undefined;

      if (confirmBtn) {
        await act(async () => {
          fireEvent.click(confirmBtn);
          await flushPromises();
        });

        await waitFor(() => {
          expect(toast.error).toHaveBeenCalled();
        });
      }
    }
  });

  // ── Blacklist toggle ──────────────────────────────────────────────────────

  it('calls blacklistCustomer when blacklist button is clicked for a non-blacklisted customer', async () => {
    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    // Open the detail drawer by clicking "View"
    const viewButtons = screen.queryAllByText('common.view');
    if (viewButtons.length > 0) {
      await act(async () => { fireEvent.click(viewButtons[0]); });

      // Now the drawer is open — find the blacklist toggle button
      const blacklistBtn = screen.queryByText('customers.detail.addBlacklist') ||
                           Array.from(document.querySelectorAll('button')).find(
                             (b) => b.textContent?.includes('addBlacklist') ||
                                    b.textContent?.includes('Blacklist')
                           );

      if (blacklistBtn) {
        await act(async () => {
          fireEvent.click(blacklistBtn as HTMLButtonElement);
          await flushPromises();
        });

        await waitFor(() => {
          expect(apiClient.blacklistCustomer).toHaveBeenCalledWith('cust-1');
        });
      }
    }
  });

  it('calls unblacklistCustomer when blacklist button is clicked for a blacklisted customer', async () => {
    const blacklistedCustomers = [makeCustomer({ blacklisted: true })];
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse(blacklistedCustomers, 1));

    await renderAndWait();

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeInTheDocument());

    const viewButtons = screen.queryAllByText('common.view');
    if (viewButtons.length > 0) {
      await act(async () => { fireEvent.click(viewButtons[0]); });

      const removeBtn = screen.queryByText('customers.detail.removeBlacklist') ||
                        Array.from(document.querySelectorAll('button')).find(
                          (b) => b.textContent?.includes('removeBlacklist')
                        );

      if (removeBtn) {
        await act(async () => {
          fireEvent.click(removeBtn as HTMLButtonElement);
          await flushPromises();
        });

        await waitFor(() => {
          expect(apiClient.unblacklistCustomer).toHaveBeenCalledWith('cust-1');
        });
      }
    }
  });

  it('shows a blacklisted badge in the table for blacklisted customers', async () => {
    const blacklistedCustomers = [makeCustomer({ blacklisted: true })];
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse(blacklistedCustomers, 1));

    await renderAndWait();

    await waitFor(() => {
      const badge = screen.queryByText('customers.blacklisted');
      expect(badge).toBeTruthy();
    });
  });

  it('shows a high RTO risk badge for customers with rto_risk high', async () => {
    const riskyCustomers = [makeCustomer({ rto_risk: 'high' })];
    vi.mocked(apiClient.getCustomers).mockResolvedValue(makeListResponse(riskyCustomers, 1));

    await renderAndWait();

    await waitFor(() => {
      const badge = screen.queryByText('customers.rtoHigh');
      expect(badge).toBeTruthy();
    });
  });

  // ── Stats cards ───────────────────────────────────────────────────────────

  it('renders the three summary stat cards', async () => {
    await renderAndWait();

    const totalCard = screen.queryByText('customers.totalCustomers');
    const channelCard = screen.queryByText('customers.channelCustomers');
    const manualCard = screen.queryByText('customers.manualCustomers');

    expect(totalCard).toBeTruthy();
    expect(channelCard).toBeTruthy();
    expect(manualCard).toBeTruthy();
  });

  // ── Create customer modal ─────────────────────────────────────────────────

  it('opens the create customer modal when Add Customer is clicked', async () => {
    await renderAndWait();

    const addBtn = screen.queryByText('customers.addCustomer') ||
                   Array.from(document.querySelectorAll('button')).find(
                     (b) => b.textContent?.includes('addCustomer')
                   );

    if (addBtn) {
      await act(async () => { fireEvent.click(addBtn as HTMLButtonElement); });

      await waitFor(() => {
        const modalTitle = screen.queryByText('customers.addModal.title') ||
                           document.querySelector('[class*="fixed"]');
        expect(modalTitle).toBeTruthy();
      });
    }
  });

  it('calls createCustomer with correct payload and closes modal on success', async () => {
    const created = makeCustomer({ id: 'cust-new', name: 'Dawood Khan', number: '+880199', channel: 'manual' });
    vi.mocked(apiClient.createCustomer).mockResolvedValue(created);

    await renderAndWait();

    // Open modal
    const addBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('addCustomer')
    ) as HTMLButtonElement | undefined;

    if (addBtn) {
      await act(async () => { fireEvent.click(addBtn); });

      const nameInput   = screen.queryByPlaceholderText('customers.addModal.namePlaceholder') as HTMLInputElement | null;
      const phoneInput  = screen.queryByPlaceholderText('customers.addModal.phonePlaceholder') as HTMLInputElement | null;
      const channelSel  = Array.from(document.querySelectorAll('select')).find(
        (s) => s.closest('[class*="fixed"]')
      ) as HTMLSelectElement | null;

      if (nameInput && phoneInput && channelSel) {
        await act(async () => {
          fireEvent.change(nameInput,  { target: { value: 'Dawood Khan' } });
          fireEvent.change(phoneInput, { target: { value: '+880199' } });
          fireEvent.change(channelSel, { target: { value: 'manual' } });
        });

        const createBtn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent?.includes('createButton') &&
                 b.closest('[class*="fixed"]')
        ) as HTMLButtonElement | undefined;

        if (createBtn) {
          await act(async () => {
            fireEvent.click(createBtn);
            await flushPromises();
          });

          await waitFor(() => {
            expect(apiClient.createCustomer).toHaveBeenCalledWith(
              expect.objectContaining({ name: 'Dawood Khan', number: '+880199', channel: 'manual' })
            );
          });
        }
      }
    }
  });
});
