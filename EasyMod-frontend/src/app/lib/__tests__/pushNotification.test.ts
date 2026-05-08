/**
 * Push Notification Service — Vitest Unit Tests
 * Tests registerServiceWorker, subscribeToPush, unsubscribeFromPush, getPushPermission
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Browser API Mocks ─────────────────────────────────────────────────────────

const mockSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub-abc123',
    toJSON: vi.fn(() => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub-abc123',
        keys: { p256dh: 'public-key-base64', auth: 'auth-secret-base64' }
    })),
    unsubscribe: vi.fn().mockResolvedValue(true)
};

const mockPushManager = {
    subscribe: vi.fn().mockResolvedValue(mockSubscription),
    getSubscription: vi.fn().mockResolvedValue(null)
};

const mockRegistration = {
    pushManager: mockPushManager,
    update: vi.fn()
};

const mockServiceWorker = {
    register: vi.fn().mockResolvedValue(mockRegistration),
    ready: Promise.resolve(mockRegistration)
};

Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: mockServiceWorker },
    writable: true,
    configurable: true
});

Object.defineProperty(globalThis, 'PushManager', {
    value: {},
    writable: true,
    configurable: true
});

const mockNotification = {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission)
};

Object.defineProperty(globalThis, 'Notification', {
    value: mockNotification,
    writable: true,
    configurable: true
});

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetchResponse = { success: true, id: 'sub-backend-1' };
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(mockFetchResponse)
}) as unknown as typeof fetch;

// ── Module under test ─────────────────────────────────────────────────────────

import {
    registerServiceWorker,
    subscribeToPush,
    unsubscribeFromPush,
    getPushPermission
} from '../pushNotification';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pushNotification service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockNotification.permission = 'default';
        mockNotification.requestPermission.mockResolvedValue('granted');
        mockPushManager.getSubscription.mockResolvedValue(null);
        mockPushManager.subscribe.mockResolvedValue(mockSubscription);
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(mockFetchResponse)
        });
    });

    // ── registerServiceWorker ─────────────────────────────────────────────────

    describe('registerServiceWorker', () => {
        it('calls navigator.serviceWorker.register with /sw.js', async () => {
            await registerServiceWorker();
            expect(mockServiceWorker.register).toHaveBeenCalledWith('/sw.js');
        });

        it('returns the service worker registration', async () => {
            const result = await registerServiceWorker();
            expect(result).toBe(mockRegistration);
        });

        it('fails gracefully when serviceWorker is not supported', async () => {
            const originalSW = navigator.serviceWorker;
            Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
            await expect(registerServiceWorker()).resolves.toBeNull();
            Object.defineProperty(navigator, 'serviceWorker', { value: originalSW, configurable: true });
        });

        it('returns null when serviceWorker.register throws', async () => {
            mockServiceWorker.register.mockRejectedValueOnce(new Error('SW not supported'));
            const result = await registerServiceWorker();
            expect(result).toBeNull();
        });
    });

    // ── getPushPermission ─────────────────────────────────────────────────────

    describe('getPushPermission', () => {
        it('returns current Notification.permission value', () => {
            mockNotification.permission = 'granted';
            expect(getPushPermission()).toBe('granted');
        });

        it('returns denied when permission is denied', () => {
            mockNotification.permission = 'denied';
            expect(getPushPermission()).toBe('denied');
        });

        it('returns default when permission not yet requested', () => {
            mockNotification.permission = 'default';
            expect(getPushPermission()).toBe('default');
        });
    });

    // ── subscribeToPush ───────────────────────────────────────────────────────

    describe('subscribeToPush', () => {
        const shopId = 'shop-1';
        const accessToken = 'Bearer test-token';

        it('requests notification permission', async () => {
            await subscribeToPush(shopId, accessToken);
            expect(mockNotification.requestPermission).toHaveBeenCalled();
        });

        it('calls pushManager.subscribe with userVisibleOnly: true', async () => {
            await subscribeToPush(shopId, accessToken);
            expect(mockPushManager.subscribe).toHaveBeenCalledWith(
                expect.objectContaining({ userVisibleOnly: true })
            );
        });

        it('includes applicationServerKey in subscribe call', async () => {
            await subscribeToPush(shopId, accessToken);
            expect(mockPushManager.subscribe).toHaveBeenCalledWith(
                expect.objectContaining({ applicationServerKey: expect.anything() })
            );
        });

        it('POSTs subscription JSON to backend', async () => {
            await subscribeToPush(shopId, accessToken);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/notifications/subscriptions'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('sends Authorization header with token', async () => {
            await subscribeToPush(shopId, accessToken);
            const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(options.headers['Authorization']).toContain('Bearer');
        });

        it('returns true when subscription succeeds', async () => {
            const result = await subscribeToPush(shopId, accessToken);
            expect(result).toBe(true);
        });

        it('returns false when notification permission is denied', async () => {
            mockNotification.requestPermission.mockResolvedValueOnce('denied');
            const result = await subscribeToPush(shopId, accessToken);
            expect(result).toBe(false);
        });
    });

    // ── unsubscribeFromPush ───────────────────────────────────────────────────

    describe('unsubscribeFromPush', () => {
        beforeEach(() => {
            mockPushManager.getSubscription.mockResolvedValue(mockSubscription);
        });

        it('calls subscription.unsubscribe()', async () => {
            await unsubscribeFromPush('sub-backend-1', 'Bearer test-token');
            expect(mockSubscription.unsubscribe).toHaveBeenCalled();
        });

        it('sends DELETE request to backend', async () => {
            await unsubscribeFromPush('sub-backend-1', 'Bearer test-token');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/notifications/subscriptions/sub-backend-1'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        it('resolves even when no active subscription found', async () => {
            mockPushManager.getSubscription.mockResolvedValueOnce(null);
            await expect(unsubscribeFromPush('sub-backend-1', 'Bearer test-token')).resolves.not.toThrow();
        });
    });
});
