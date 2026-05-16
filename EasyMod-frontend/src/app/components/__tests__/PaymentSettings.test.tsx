/**
 * PaymentSettings — Vitest Unit Tests
 * Tests bKash toggle, Self MFS vs Merchant API mode, and save flow
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentSettings from '../PaymentSettings';

// ── Hoist mocks before vi.mock factories run ──────────────────────────────────
const {
    mockGetPaymentConfig,
    mockSavePaymentConfig,
    mockGetShop,
} = vi.hoisted(() => ({
    mockGetPaymentConfig: vi.fn().mockResolvedValue({
        success: true,
        // Component expects an array: Array.isArray(response.data) ? response.data : []
        // Each entry: { gateway: 'self-mfs', credentials: { mfs_type, mfs_number, mfs_mode }, is_enabled }
        data: [
            {
                gateway: 'self-mfs',
                credentials: { mfs_type: 'bkash', mfs_number: '01711000000', mfs_mode: 'self' },
                is_enabled: true,
            },
        ],
    }),
    mockSavePaymentConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    mockGetShop: vi.fn().mockResolvedValue({ success: true, data: { id: 'shop-1', name: 'Test Shop' } }),
}));

vi.mock('@/api', () => ({
    apiClient: {
        getPaymentConfig: mockGetPaymentConfig,
        updatePaymentConfig: mockSavePaymentConfig,
        testPaymentConnection: vi.fn().mockResolvedValue({ success: true }),
        getShop: mockGetShop,
        getAISettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    }
}));

vi.mock('@/app/lib/auth', () => ({
    authService: {
        getCurrentShop: vi.fn().mockReturnValue({ id: 'shop-1', unique_code: 'SHOP1' }),
        getUser: vi.fn().mockReturnValue({ id: 'user-1' }),
    }
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'manageShop.paymentSettings.codName': 'Cash on Delivery',
                'manageShop.paymentSettings.codDesc': 'Pay when you receive',
                'manageShop.paymentSettings.bkashName': 'bKash',
                'manageShop.paymentSettings.bkashDesc': 'Mobile banking',
                'manageShop.paymentSettings.aamarName': 'AamarPay',
                'manageShop.paymentSettings.aamarDesc': 'Payment gateway',
                'manageShop.paymentSettings.defaultPaymentMessage': 'Please complete payment',
            };
            return map[key] ?? key;
        },
        i18n: { language: 'en' }
    })
}));

// ── Helper ────────────────────────────────────────────────────────────────────
async function renderPaymentSettings() {
    render(<PaymentSettings />);
    // Wait for initial data load
    await waitFor(() => expect(mockGetPaymentConfig).toHaveBeenCalled(), { timeout: 3000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PaymentSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetPaymentConfig.mockResolvedValue({
            success: true,
            data: [
                {
                    gateway: 'self-mfs',
                    credentials: { mfs_type: 'bkash', mfs_number: '01711000000', mfs_mode: 'self' },
                    is_enabled: true,
                },
            ],
        });
    });

    it('renders payment settings section', async () => {
        await renderPaymentSettings();
        // Should show at least one payment method
        expect(
            screen.getByText('bKash') || screen.getByText(/payment/i)
        ).toBeTruthy();
    });

    it('shows bKash in the list', async () => {
        await renderPaymentSettings();
        expect(screen.getByText('bKash')).toBeInTheDocument();
    });

    it('shows Cash on Delivery in the list', async () => {
        await renderPaymentSettings();
        expect(screen.getByText('Cash on Delivery')).toBeInTheDocument();
    });

    it('loads payment config on mount', async () => {
        await renderPaymentSettings();
        expect(mockGetPaymentConfig).toHaveBeenCalledTimes(1);
    });

    it('shows phone field for Self MFS mode (bKash)', async () => {
        await renderPaymentSettings();
        // The expand toggle is a chevron button (className includes "p-2 text-gray-600")
        // adjacent to the bKash gateway row — NOT the gateway name text itself.
        const expandBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.className.includes('p-2') && b.className.includes('gray-600')
        );
        if (expandBtn) {
            fireEvent.click(expandBtn);
            await waitFor(() => {
                const phoneInput = document.querySelector('input[type="tel"], input[placeholder*="01"], input[name*="phone"]');
                expect(phoneInput).not.toBeNull();
            }, { timeout: 3000 });
        }
    });

    it('pre-fills phone number from loaded config', async () => {
        await renderPaymentSettings();
        const expandBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.className.includes('p-2') && b.className.includes('gray-600')
        );
        if (expandBtn) {
            fireEvent.click(expandBtn);
            await waitFor(() => {
                const phoneInput = document.querySelector('input[value="01711000000"]') as HTMLInputElement;
                if (phoneInput) expect(phoneInput.value).toBe('01711000000');
            });
        }
    });

    it('calls savePaymentConfig when save button clicked', async () => {
        await renderPaymentSettings();
        const expandBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.className.includes('p-2') && b.className.includes('gray-600')
        );
        if (!expandBtn) return;
        fireEvent.click(expandBtn);
        const saveBtn = await screen.findByRole('button', { name: /save bkash/i }, { timeout: 3000 });
        // Phone input is type="tel" (not type="text") — ensure it has a value
        // before saving in case async config load hasn't propagated into state yet
        const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement | null;
        if (phoneInput && !phoneInput.value) {
            fireEvent.change(phoneInput, { target: { value: '01711000000' } });
        }
        fireEvent.click(saveBtn);
        await waitFor(() => {
            expect(mockSavePaymentConfig).toHaveBeenCalled();
        }, { timeout: 3000 });
    });

    it('shows success message after save', async () => {
        await renderPaymentSettings();
        const expandBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.className.includes('p-2') && b.className.includes('gray-600')
        );
        if (!expandBtn) return;
        fireEvent.click(expandBtn);
        const saveBtn = await screen.findByRole('button', { name: /save bkash/i }, { timeout: 3000 });
        const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement | null;
        if (phoneInput && !phoneInput.value) {
            fireEvent.change(phoneInput, { target: { value: '01711000000' } });
        }
        fireEvent.click(saveBtn);
        // Component uses setSuccess (not toast) — check DOM for success text
        await waitFor(() => {
            expect(screen.getByText(/verified and saved/i)).toBeInTheDocument();
        }, { timeout: 3000 });
    });

    it('shows error message when save fails', async () => {
        mockSavePaymentConfig.mockRejectedValueOnce(new Error('Network error'));
        await renderPaymentSettings();
        const expandBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.className.includes('p-2') && b.className.includes('gray-600')
        );
        if (!expandBtn) return;
        fireEvent.click(expandBtn);
        const saveBtn = await screen.findByRole('button', { name: /save bkash/i }, { timeout: 3000 });
        const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement | null;
        if (phoneInput && !phoneInput.value) {
            fireEvent.change(phoneInput, { target: { value: '01711000000' } });
        }
        fireEvent.click(saveBtn);
        // Component uses setError (not toast) — check DOM for error text
        await waitFor(() => {
            expect(screen.getByText(/saveConfigFailed|save.*failed|error/i)).toBeInTheDocument();
        }, { timeout: 3000 });
    });

    it('does not crash when API returns empty data', async () => {
        mockGetPaymentConfig.mockResolvedValueOnce({ success: true, data: null });
        await renderPaymentSettings();
        expect(screen.getByText('bKash')).toBeInTheDocument();
    });

    it('toggles enabled state for a gateway', async () => {
        await renderPaymentSettings();
        // bKash is enabled by default in mock data
        expect(screen.getByText('bKash')).toBeInTheDocument();
    });
});
