/**
 * Dashboard Service Tests
 * Tests for business logic in dashboard.service.js
 */
const dashboardService = require('../dashboard.service');
const cacheService = require('../../../utils/cache.service');

// Mock dependencies
jest.mock('../entities', () => ({
    Order: {
        count: jest.fn(),
        findAll: jest.fn()
    },
    Product: {
        count: jest.fn()
    },
    Channel: {
        count: jest.fn()
    },
    Analytics: {
        sum: jest.fn(),
        findOne: jest.fn()
    }
}));

jest.mock('../../../utils/cache.service', () => ({
    getForShop: jest.fn(),
    setForShop: jest.fn()
}));

const { Order, Product, Channel, Analytics } = require('../../entities');

describe('Dashboard Service', () => {
    const mockShopId = '550e8400-e29b-41d4-a716-446655440000';
    const mockUserId = '550e8400-e29b-41d4-a716-446655440001';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getDashboardMetrics', () => {
        it('should return cached data if available', async () => {
            const cachedData = {
                metrics: { totalMessages: 100, ordersToday: 5 },
                period: 30
            };
            cacheService.getForShop.mockResolvedValue(cachedData);

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId, 30);

            expect(result).toEqual(cachedData);
            expect(cacheService.getForShop).toHaveBeenCalledWith(mockShopId, 'dashboard:summary:30');
            expect(Analytics.sum).not.toHaveBeenCalled();
        });

        it('should calculate metrics correctly when no cache', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum.mockResolvedValue(100);
            Product.count.mockResolvedValue(50);
            Order.count.mockResolvedValue(10);
            Channel.count.mockResolvedValue(3);
            Analytics.findOne.mockResolvedValue({ total_messages: 100 });

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId, 30);

            expect(result.metrics.totalMessages).toBe(100);
            expect(result.metrics.activeProducts).toBe(50);
            expect(result.metrics.ordersToday).toBe(10);
            expect(result.channels.active).toBe(3);
            expect(cacheService.setForShop).toHaveBeenCalled();
        });

        it('should handle null/undefined values gracefully', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum.mockResolvedValue(null);
            Product.count.mockResolvedValue(null);
            Order.count.mockResolvedValue(null);
            Channel.count.mockResolvedValue(null);
            Analytics.findOne.mockResolvedValue(null);

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId);

            expect(result.metrics.totalMessages).toBe(0);
            expect(result.metrics.activeProducts).toBe(0);
            expect(result.metrics.ordersToday).toBe(0);
        });

        it('should calculate conversion rate correctly', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum
                .mockResolvedValueOnce(200) // total messages
                .mockResolvedValueOnce(100); // messages in period
            Product.count.mockResolvedValue(50);
            Order.count.mockResolvedValue(25);
            Channel.count.mockResolvedValue(3);
            Analytics.findOne.mockResolvedValue(null);

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId, 30);

            // 25 orders / 100 messages * 100 = 25%
            expect(result.metrics.conversionRate).toBe(25);
        });

        it('should handle division by zero for conversion rate', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum.mockResolvedValue(0);
            Product.count.mockResolvedValue(0);
            Order.count.mockResolvedValue(0);
            Channel.count.mockResolvedValue(0);
            Analytics.findOne.mockResolvedValue(null);

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId);

            expect(result.metrics.conversionRate).toBe(0);
        });

        it('should calculate weekly change correctly', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum.mockResolvedValue(0);
            Product.count.mockResolvedValue(0);
            Order.count
                .mockResolvedValueOnce(10) // orders today
                .mockResolvedValueOnce(20) // orders in period
                .mockResolvedValueOnce(16); // orders last period (20% increase from 16 to 20)
            Channel.count.mockResolvedValue(0);
            Analytics.findOne.mockResolvedValue(null);

            const result = await dashboardService.getDashboardMetrics(mockUserId, mockShopId);

            // (20 - 16) / 16 * 100 = 25%
            expect(result.metrics.weeklyChange).toBe(25);
        });
    });

    describe('getDashboardChart', () => {
        it('should return cached chart data if available', async () => {
            const cachedData = [{ date: '2024-01-01', orders: 5 }];
            cacheService.getForShop.mockResolvedValue(cachedData);

            const result = await dashboardService.getDashboardChart(mockShopId, 30);

            expect(result).toEqual(cachedData);
            expect(Order.findAll).not.toHaveBeenCalled();
        });

        it('should generate chart data with all days filled', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            const today = new Date();
            const dateKey = today.toISOString().split('T')[0];
            
            Order.findAll.mockResolvedValue([
                { date: dateKey, orders: 5 }
            ]);

            const result = await dashboardService.getDashboardChart(mockShopId, 7);

            expect(result).toHaveLength(7);
            expect(result[6].orders).toBe(5); // Today
            expect(result[0].orders).toBe(0); // 6 days ago
        });

        it('should handle empty order data', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            Order.findAll.mockResolvedValue([]);

            const result = await dashboardService.getDashboardChart(mockShopId, 7);

            expect(result).toHaveLength(7);
            expect(result.every(d => d.orders === 0)).toBe(true);
        });
    });

    describe('getDashboardMetricsById', () => {
        it('should return null if shopId does not match', async () => {
            const result = await dashboardService.getDashboardMetricsById(
                'different-shop-id',
                mockUserId,
                mockShopId,
                30
            );

            expect(result).toBeNull();
        });

        it('should return combined metrics when shopId matches', async () => {
            cacheService.getForShop.mockResolvedValue(null);
            
            Analytics.sum.mockResolvedValue(0);
            Product.count.mockResolvedValue(0);
            Order.count.mockResolvedValue(0);
            Channel.count.mockResolvedValue(0);
            Analytics.findOne.mockResolvedValue(null);
            Order.findAll.mockResolvedValue([]);

            const result = await dashboardService.getDashboardMetricsById(
                mockShopId,
                mockUserId,
                mockShopId,
                30
            );

            expect(result).toHaveProperty('metrics');
            expect(result).toHaveProperty('chartData');
        });
    });
});
