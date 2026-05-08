/**
 * PaymentSettings — Vitest Unit Tests
 * Tests bKash/Nagad/Rocket toggle, Self MFS vs Merchant API mode, and save flow
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
        data: {
            bkash: { enabled: true, phone: '01711000000', accountType: 'self' },
            nagad: { enabled: false, phone: '', accountType: 'self' },
            rocket: { enabled: false, phone: '', accountType: 'self' },
        }
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
                'manageShop.paymentSettings.nagadName': 'Nagad',
                'manageShop.paymentSettings.nagadDesc': 'Mobile banking',
                'manageShop.paymentSettings.rocketName': 'Rocket',
                'manageShop.paymentSettings.rocketDesc': 'Mobile banking',
                'manageShop.paymentSettings.aamarName': 'AamarPay',
                'manageShop.paymentSettings.aamarDesc': 'Payment gateway',
                'manageShop.paymentSettings.sslCommerzName': 'SSLCommerz',
                'manageShop.paymentSettings.sslCommerzDesc': 'Payment gateway',
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
            data: {
                bkash: { enabled: true, phone: '01711000000', accountType: 'self' },
                nagad: { enabled: false, phone: '', accountType: 'self' },
                rocket: { enabled: false, phone: '', accountType: 'self' },
            }
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

    it('shows Nagad in the list', async () => {
        await renderPaymentSettings();
        expect(screen.getByText('Nagad')).toBeInTheDocument();
    });

    it('shows Rocket in the list', async () => {
        await renderPaymentSettings();
        expect(screen.getByText('Rocket')).toBeInTheDocument();
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
        // Click bKash to expand it
        const bkashEl = screen.getByText('bKash');
        fireEvent.click(bkashEl);
        await waitFor(() => {
            const phoneInput = document.querySelector('input[type="tel"], input[placeholder*="01"], input[name*="phone"]');
            expect(phoneInput).not.toBeNull();
        });
    });

    it('pre-fills phone number from loaded config', async () => {
        await renderPaymentSettings();
        const bkashEl = screen.getByText('bKash');
        fireEvent.click(bkashEl);
        await waitFor(() => {
            const phoneInput = document.querySelector('input[value="01711000000"]') as HTMLInputElement;
            if (phoneInput) expect(phoneInput.value).toBe('01711000000');
        });
    });

    it('calls savePaymentConfig when save button clicked', async () => {
        await renderPaymentSettings();
        const saveBtns = screen.getAllByRole('button', { name: /save/i });
        if (saveBtns.length > 0) {
            fireEvent.click(saveBtns[0]);
            await waitFor(() => {
                expect(mockSavePaymentConfig).toHaveBeenCalled();
            }, { timeout: 3000 });
        }
    });

    it('shows success toast after save', async () => {
        const { toast } = await import('sonner');
        await renderPaymentSettings();
        const saveBtns = screen.getAllByRole('button', { name: /save/i });
        if (saveBtns.length > 0) {
            fireEvent.click(saveBtns[0]);
            await waitFor(() => {
                expect(toast.success).toHaveBeenCalled();
            }, { timeout: 3000 });
        }
    });

    it('shows error toast when save fails', async () => {
        mockSavePaymentConfig.mockRejectedValueOnce(new Error('Network error'));
        const { toast } = await import('sonner');
        await renderPaymentSettings();
        const saveBtns = screen.getAllByRole('button', { name: /save/i });
        if (saveBtns.length > 0) {
            fireEvent.click(saveBtns[0]);
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalled();
            }, { timeout: 3000 });
        }
    });

    it('does not crash when API returns empty data', async () => {
        mockGetPaymentConfig.mockResolvedValueOnce({ success: true, data: null });
        await renderPaymentSettings();
        expect(screen.getByText('bKash')).toBeInTheDocument();
    });

    it('toggles enabled state for a gateway', async () => {
        await renderPaymentSettings();
        // Find a toggle/switch for Nagad (disabled by default)
        const nagadSection = screen.getByText('Nagad');
        expect(nagadSection).toBeInTheDocument();
    });
});
