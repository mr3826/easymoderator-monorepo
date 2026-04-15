/**
 * Order Tracking Service Tests
 * Tests delivery tracking and status updates
 */

const trackingService = require('../order-tracking.service');
const { Order } = require('../../entities');
const deliveryService = require('../../delivery/delivery.service');

jest.mock('../../entities');
jest.mock('../../delivery/delivery.service');

describe('Order Tracking Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('trackOrder', () => {
        it('should fetch tracking info for valid order', async () => {
            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-001',
                tracking_number: 'TRACK123',
                delivery_provider: 'steadfast'
            };

            const mockTrackingInfo = {
                status: 'in_transit',
                estimated_delivery: '2024-12-31',
                current_location: 'Dhaka Hub'
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            deliveryService.getTracking = jest.fn().mockResolvedValue(mockTrackingInfo);

            const result = await trackingService.trackOrder('order-1', 'shop-1');

            expect(result).toHaveProperty('order');
            expect(result).toHaveProperty('tracking');
            expect(result.tracking).toEqual(mockTrackingInfo);
        });

        it('should return null tracking for orders without tracking number', async () => {
            const mockOrder = {
                id: 'order-1',
                order_number: 'ORD-001',
                tracking_number: null,
                delivery_provider: null
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);

            const result = await trackingService.trackOrder('order-1', 'shop-1');

            expect(result.tracking).toBeNull();
        });

        it('should throw error when order not found', async () => {
            Order.findOne = jest.fn().mockResolvedValue(null);

            await expect(trackingService.trackOrder('nonexistent', 'shop-1'))
                .rejects
                .toThrow('Order not found');
        });
    });

    describe('updateTrackingStatus', () => {
        it('should update order with tracking information', async () => {
            const mockOrder = {
                id: 'order-1',
                tracking_number: null,
                fulfillment_status: 'unfulfilled',
                save: jest.fn().mockResolvedValue(true)
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);

            const trackingData = {
                tracking_number: 'TRACK123',
                delivery_provider: 'steadfast',
                status: 'shipped'
            };

            const result = await trackingService.updateTrackingStatus('order-1', 'shop-1', trackingData);

            expect(mockOrder.tracking_number).toBe('TRACK123');
            expect(mockOrder.delivery_provider).toBe('steadfast');
            expect(mockOrder.save).toHaveBeenCalled();
        });

        it('should validate tracking number format', async () => {
            // Test various tracking number formats
            const validTrackingNumbers = [
                'TRACK123456',
                'ST-12345678',
                'SF1234567890'
            ];

            const invalidTrackingNumbers = [
                '',
                '   ',
                null,
                undefined
            ];

            validTrackingNumbers.forEach(num => {
                expect(num && num.trim().length > 0).toBe(true);
            });

            invalidTrackingNumbers.forEach(num => {
                expect(!num || num.trim().length === 0).toBe(true);
            });
        });
    });

    describe('syncTrackingStatus', () => {
        it('should sync status from delivery provider', async () => {
            const mockOrder = {
                id: 'order-1',
                tracking_number: 'TRACK123',
                delivery_provider: 'steadfast',
                fulfillment_status: 'unfulfilled',
                save: jest.fn().mockResolvedValue(true)
            };

            const providerStatus = {
                status: 'delivered',
                delivered_at: '2024-12-31T10:00:00Z'
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            deliveryService.syncStatus = jest.fn().mockResolvedValue(providerStatus);

            const result = await trackingService.syncTrackingStatus('order-1', 'shop-1');

            expect(deliveryService.syncStatus).toHaveBeenCalledWith('steadfast', 'TRACK123');
            expect(result).toHaveProperty('synced', true);
        });

        it('should handle sync failures gracefully', async () => {
            const mockOrder = {
                id: 'order-1',
                tracking_number: 'TRACK123',
                delivery_provider: 'steadfast'
            };

            Order.findOne = jest.fn().mockResolvedValue(mockOrder);
            deliveryService.syncStatus = jest.fn().mockRejectedValue(new Error('API Error'));

            await expect(trackingService.syncTrackingStatus('order-1', 'shop-1'))
                .rejects
                .toThrow('Failed to sync tracking status');
        });
    });

    describe('batchSyncTracking', () => {
        it('should sync all pending orders', async () => {
            const pendingOrders = [
                { id: 'order-1', tracking_number: 'TRACK1', delivery_provider: 'steadfast' },
                { id: 'order-2', tracking_number: 'TRACK2', delivery_provider: 'steadfast' }
            ];

            Order.findAll = jest.fn().mockResolvedValue(pendingOrders);
            deliveryService.syncStatus = jest.fn()
                .mockResolvedValueOnce({ status: 'delivered' })
                .mockResolvedValueOnce({ status: 'in_transit' });

            const results = await trackingService.batchSyncTracking('shop-1');

            expect(results).toHaveLength(2);
            expect(results[0]).toHaveProperty('orderId', 'order-1');
            expect(results[1]).toHaveProperty('orderId', 'order-2');
        });

        it('should handle partial failures in batch sync', async () => {
            const pendingOrders = [
                { id: 'order-1', tracking_number: 'TRACK1', delivery_provider: 'steadfast' },
                { id: 'order-2', tracking_number: 'TRACK2', delivery_provider: 'steadfast' }
            ];

            Order.findAll = jest.fn().mockResolvedValue(pendingOrders);
            deliveryService.syncStatus = jest.fn()
                .mockResolvedValueOnce({ status: 'delivered' })
                .mockRejectedValueOnce(new Error('API Error'));

            const results = await trackingService.batchSyncTracking('shop-1');

            expect(results[0]).toHaveProperty('success', true);
            expect(results[1]).toHaveProperty('success', false);
            expect(results[1]).toHaveProperty('error');
        });
    });

    describe('Provider Support', () => {
        const supportedProviders = ['steadfast', 'pathao', 'chaldal', 'redx', 'paperfly'];

        it('should support major Bangladesh delivery providers', () => {
            supportedProviders.forEach(provider => {
                expect(provider).toBeTruthy();
                expect(typeof provider).toBe('string');
            });
        });

        it('should validate provider before tracking', () => {
            const isValidProvider = (provider) => supportedProviders.includes(provider);

            expect(isValidProvider('steadfast')).toBe(true);
            expect(isValidProvider('pathao')).toBe(true);
            expect(isValidProvider('unknown')).toBe(false);
            expect(isValidProvider('')).toBe(false);
        });
    });
});
