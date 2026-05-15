/**
 * Dashboard Controller Tests
 * Tests for HTTP request handling
 */
const dashboardController = require('../dashboard.controller');
const dashboardService = require('../dashboard.service');
const dashboardAnalytics = require('../dashboard.analytics');

// Mock dependencies
jest.mock('../dashboard.service');
jest.mock('../dashboard.analytics');
jest.mock('../../entities', () => ({
    Order: {
        count: jest.fn(),
        findAll: jest.fn()
    },
    Conversation: {
        count: jest.fn()
    }
}));

const { Order, Conversation } = require('../../entities');

describe('Dashboard Controller', () => {
    const mockShopId = '550e8400-e29b-41d4-a716-446655440000';
    const mockUserId = '550e8400-e29b-41d4-a716-446655440001';

    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockReq = {
            user: {
                userId: mockUserId,
                shopId: mockShopId
            },
            query: {},
            params: {},
            body: {}
        };
        
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        
        mockNext = jest.fn();
    });

    describe('getDashboardMetricsRest', () => {
        it('should return 200 with metrics data', async () => {
            const mockMetrics = {
                metrics: { totalMessages: 100, ordersToday: 5 },
                period: 30
            };
            dashboardService.getDashboardMetrics.mockResolvedValue(mockMetrics);

            await dashboardController.getDashboardMetricsRest(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: mockMetrics
            });
        });

        it('should use default period of 30 when not specified', async () => {
            dashboardService.getDashboardMetrics.mockResolvedValue({});

            await dashboardController.getDashboardMetricsRest(mockReq, mockRes, mockNext);

            expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(
                mockUserId,
                mockShopId,
                30
            );
        });

        it('should use specified period from query', async () => {
            mockReq.query.period = '7';
            dashboardService.getDashboardMetrics.mockResolvedValue({});

            await dashboardController.getDashboardMetricsRest(mockReq, mockRes, mockNext);

            expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(
                mockUserId,
                mockShopId,
                7
            );
        });

        it('should call next with error on failure', async () => {
            const error = new Error('Database error');
            dashboardService.getDashboardMetrics.mockRejectedValue(error);

            await dashboardController.getDashboardMetricsRest(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalledWith(error);
        });
    });

    describe('getDashboardMetricsById', () => {
        it('should return 200 with metrics when found', async () => {
            mockReq.params.id = mockShopId;
            const mockMetrics = {
                metrics: { totalMessages: 100 },
                chartData: []
            };
            dashboardService.getDashboardMetricsById.mockResolvedValue(mockMetrics);

            await dashboardController.getDashboardMetricsById(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: mockMetrics
            });
        });

        it('should return 404 when metrics not found', async () => {
            mockReq.params.id = 'different-id';
            dashboardService.getDashboardMetricsById.mockResolvedValue(null);

            await dashboardController.getDashboardMetricsById(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Dashboard not found.'
                }
            });
        });
    });

    describe('getDashboardChart', () => {
        it('should return 200 with chart data', async () => {
            const mockChartData = [
                { date: '2024-01-01', orders: 5 },
                { date: '2024-01-02', orders: 8 }
            ];
            dashboardService.getDashboardChart.mockResolvedValue(mockChartData);

            await dashboardController.getDashboardChart(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: mockChartData
            });
        });

        it('should pass period to service', async () => {
            mockReq.query.period = '7';
            dashboardService.getDashboardChart.mockResolvedValue([]);

            await dashboardController.getDashboardChart(mockReq, mockRes, mockNext);

            expect(dashboardService.getDashboardChart).toHaveBeenCalledWith(mockShopId, 7);
        });
    });

    describe('logAnalyticsEvent', () => {
        it('should return 201 with event_id', async () => {
            const mockRow = { id: 123 };
            dashboardAnalytics.logEvent.mockResolvedValue(mockRow);

            mockReq.body = {
                event_type: 'message',
                timestamp: new Date().toISOString()
            };

            await dashboardController.logAnalyticsEvent(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({
                event_id: '123',
                logged: true
            });
        });

        it('should pass payload to analytics service', async () => {
            dashboardAnalytics.logEvent.mockResolvedValue({ id: 1 });
            mockReq.body = { event_type: 'message' };

            await dashboardController.logAnalyticsEvent(mockReq, mockRes, mockNext);

            expect(dashboardAnalytics.logEvent).toHaveBeenCalledWith(
                mockShopId,
                mockReq.body
            );
        });
    });

    describe('logAnalyticsMetric', () => {
        it('should return 201 when recorded', async () => {
            dashboardAnalytics.logMetric.mockResolvedValue();
            mockReq.body = {
                metric_type: 'response_time',
                value: 150
            };

            await dashboardController.logAnalyticsMetric(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(201);
            expect(mockRes.json).toHaveBeenCalledWith({ recorded: true });
        });
    });

    describe('getAnalyticsDashboard', () => {
        it('should return aggregated analytics data', async () => {
            const mockTotals = {
                total_messages: 1000,
                llm_calls: 500,
                cache_hits: 800,
                keyword_matches: 200,
                cost_estimate: 25.50
            };
            dashboardAnalytics.getDashboardAnalytics.mockResolvedValue({
                totals: mockTotals
            });

            await dashboardController.getAnalyticsDashboard(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                total_messages: 1000,
                llm_calls: 500,
                cache_hits: 800,
                keyword_matches: 200,
                cost_estimate: 25.50
            }));
        });

        it('should include placeholder metrics', async () => {
            dashboardAnalytics.getDashboardAnalytics.mockResolvedValue({
                totals: {
                    total_messages: 0,
                    llm_calls: 0,
                    cache_hits: 0,
                    keyword_matches: 0,
                    cost_estimate: 0
                }
            });

            await dashboardController.getAnalyticsDashboard(mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                avg_response_time_ms: 0,
                intent_breakdown: {},
                handover_rate: 0,
                customer_satisfaction: 0,
                error_rate: 0
            }));
        });
    });

    describe('getTodayQueue', () => {
        it('should return queue counts', async () => {
            Order.count
                .mockResolvedValueOnce(5)  // pendingPaymentCount
                .mockResolvedValueOnce(3);   // readyToDispatchCount
            Conversation.count.mockResolvedValue(10);  // unreadCount
            Order.findAll.mockResolvedValue([]);

            await dashboardController.getTodayQueue(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: expect.objectContaining({
                    unread_count: 10,
                    pending_payment_count: 5,
                    ready_to_dispatch_count: 3,
                    at_risk_orders: []
                })
            });
        });

        it('should map at-risk orders correctly', async () => {
            Order.count.mockResolvedValue(0);
            Conversation.count.mockResolvedValue(0);
            Order.findAll.mockResolvedValue([
                {
                    id: 'order-1',
                    customer_name: 'John Doe',
                    customer_phone: '+1234567890',
                    fulfillment_status: 'attempted',
                    delivery_tracking_code: 'TRACK123'
                }
            ]);

            await dashboardController.getTodayQueue(mockReq, mockRes, mockNext);

            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    at_risk_orders: [
                        {
                            id: 'order-1',
                            customer_name: 'John Doe',
                            customer_phone: '+1234567890',
                            status: 'attempted',
                            tracking_id: 'TRACK123'
                        }
                    ]
                })
            }));
        });
    });

    describe('Legacy getDashboardMetrics', () => {
        it('should still work for backward compatibility', async () => {
            const mockMetrics = { metrics: { ordersToday: 5 } };
            dashboardService.getDashboardMetrics.mockResolvedValue(mockMetrics);

            await dashboardController.getDashboardMetrics(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                data: mockMetrics
            });
        });
    });
});
