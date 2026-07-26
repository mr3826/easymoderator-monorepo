/**
 * BKashCheckout — bKash purchasing gate (launch remediation, §6).
 *
 * When bKash is disabled (VITE_BKASH_ENABLED !== "true"), the component must
 * show an honest unavailable state and NO purchase button.
 */

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BKashCheckout } from '../BKashCheckout';

// i18n: return the provided fallback (2nd arg) or the key.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

vi.mock('@/api', () => ({
    apiClient: { purchaseConversationPack: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const setBkashEnabled = (value: string | undefined) => {
    if (value === undefined) {
        vi.stubEnv('VITE_BKASH_ENABLED', '');
    } else {
        vi.stubEnv('VITE_BKASH_ENABLED', value);
    }
};

beforeEach(() => {
    vi.unstubAllEnvs();
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe('BKashCheckout purchasing gate', () => {
    it('renders an honest unavailable state when bKash is disabled', () => {
        setBkashEnabled(undefined);
        render(<BKashCheckout />);
        expect(screen.getByTestId('bkash-unavailable')).toBeInTheDocument();
        // No purchase button of any kind.
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('treats any non-"true" value as disabled', () => {
        setBkashEnabled('false');
        render(<BKashCheckout />);
        expect(screen.getByTestId('bkash-unavailable')).toBeInTheDocument();
    });

    it('renders the purchase surface when explicitly enabled', () => {
        setBkashEnabled('true');
        render(<BKashCheckout />);
        expect(screen.queryByTestId('bkash-unavailable')).toBeNull();
        // Pack buttons + the request-invoice button are present.
        expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });
});
