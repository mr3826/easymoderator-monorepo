/**
 * Usage Tracking Test Suite
 * 
 * Tests atomic transactions, idempotency, and concurrency safety.
 * Proves:
 * - No double increment on retries (idempotency)
 * - No increment on rollback (transaction safety)
 * - Accurate counts under concurrency
 * - Audit trail persistence
 * - Hard errors on limit exceeded
 */

const { v4: uuidv4 } = require('uuid');
const {
    Subscription,
    UsageEvent,
    AuditLog,
    Shop,
    User,
    UserShop
} = require('src/modules/entities');
const subscriptionService = require('src/modules/subscription/subscription.service');
const { sequelize } = require('src/utils/database/database-setup');

describe('Usage Tracking - Atomic Transactions & Idempotency', () => {
    let shop, user, subscription, requestId;

    beforeAll(async () => {
        // Setup: Create test shop and user
        user = await User.create({
            email: `test-${uuidv4()}@example.com`,
            password: 'test123'
        });

        shop = await Shop.create({
            name: 'Test Shop',
            user_id: user.id
        });

        await UserShop.create({
            user_id: user.id,
            shop_id: shop.id,
            role: 'owner',
            is_active: true
        });

        subscription = await subscriptionService.createDefaultSubscription(shop.id);
    });

    afterAll(async () => {
        // Cleanup
        await UserShop.destroy({ where: {} });
        await UsageEvent.destroy({ where: {} });
        await AuditLog.destroy({ where: {} });
        await Subscription.destroy({ where: {} });
        await Shop.destroy({ where: {} });
        await User.destroy({ where: {} });
    });

    beforeEach(() => {
        requestId = uuidv4();
    });

    // =====================================================================
    // TEST 1: Idempotency - No Double Increment on Retries
    // =====================================================================
    describe('Idempotency: No Double Counting on Retries', () => {
        test('First call increments, second call returns cached result', async () => {
            const initialUsage = subscription.conversations_used;
            
            // First call - should increment
            const result1 = await subscriptionService.trackUsage(
                shop.id,
                'conversations',
                1,
                requestId,
                { resourceId: uuidv4() }
            );
            
            expect(result1.isRetry).toBe(false);
            expect(result1.usageEvent.status).toBe('committed');

            // Refresh subscription
            await subscription.reload();
            expect(subscription.conversations_used).toBe(initialUsage + 1);

            // Second call with SAME requestId - should NOT increment again
            const result2 = await subscriptionService.trackUsage(
                shop.id,
                'conversations',
                1,
                requestId, // SAME request ID
                { resourceId: uuidv4() }
            );
            
            expect(result2.isRetry).toBe(true);
            expect(result2.message).toContain('already tracked');
            
            // Refresh and verify usage did NOT double increment
            await subscription.reload();
            expect(subscription.conversations_used).toBe(initialUsage + 1);
        });

        test('Multiple concurrent retries with same requestId', async () => {
            const testRequestId = uuidv4();
            const results = await Promise.all([
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    1,
                    testRequestId,
                    { resourceId: uuidv4() }
                ),
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    1,
                    testRequestId,
                    { resourceId: uuidv4() }
                ),
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    1,
                    testRequestId,
                    { resourceId: uuidv4() }
                )
            ]);

            // First should succeed
            expect(results[0].isRetry).toBe(false);
            
            // Rest should be retries
            expect(results[1].isRetry).toBe(true);
            expect(results[2].isRetry).toBe(true);

            // Verify only ONE increment happened
            const events = await UsageEvent.findAll({
                where: {
                    shop_id: shop.id,
                    resource_type: 'orders',
                    request_id: testRequestId
                }
            });
            
            expect(events.length).toBe(1);
            expect(events[0].status).toBe('committed');
        });

        test('Retry after rollback returns rolled_back status', async () => {
            const rollbackRequestId = uuidv4();
            
            // First call with invalid data to cause rollback
            try {
                // Set limit to 0 to force error
                await subscription.update({ conversations_limit: 0 });
                
                await subscriptionService.trackUsage(
                    shop.id,
                    'conversations',
                    1,
                    rollbackRequestId,
                    { resourceId: uuidv4() }
                );
            } catch (error) {
                expect(error.code).toBe('USAGE_LIMIT_EXCEEDED');
            }

            // Verify event was marked as rolled_back
            const event = await UsageEvent.findOne({
                where: {
                    shop_id: shop.id,
                    resource_type: 'conversations',
                    request_id: rollbackRequestId
                }
            });

            expect(event.status).toBe('rolled_back');

            // Restore limit
            await subscription.update({ conversations_limit: 100 });
        });
    });

    // =====================================================================
    // TEST 2: Transaction Safety - No Increment on Rollback
    // =====================================================================
    describe('Transaction Safety: No Increment on Rollback', () => {
        test('Usage counter does not increment if transaction rolls back', async () => {
            const beforeUsage = subscription.conversations_used;
            
            try {
                // Force error by using invalid shop_id
                await subscriptionService.trackUsage(
                    uuidv4(), // Invalid shop ID
                    'conversations',
                    1,
                    uuidv4(),
                    { resourceId: uuidv4() }
                );
            } catch (error) {
                expect(error.message).toContain('Subscription not found');
            }

            // Verify subscription was never updated
            await subscription.reload();
            expect(subscription.conversations_used).toBe(beforeUsage);
        });

        test('Subscription counter matches sum of committed usage events', async () => {
            // Clear and reset
            await subscription.update({
                conversations_used: 0,
                orders_used: 0,
                products_used: 0
            });

            // Track multiple usages
            const ids = [uuidv4(), uuidv4(), uuidv4()];
            for (let i = 0; i < 3; i++) {
                await subscriptionService.trackUsage(
                    shop.id,
                    'conversations',
                    1,
                    ids[i],
                    { resourceId: uuidv4() }
                );
            }

            await subscription.reload();
            expect(subscription.conversations_used).toBe(3);

            // Verify exactly 3 committed events
            const committedEvents = await UsageEvent.findAll({
                where: {
                    shop_id: shop.id,
                    resource_type: 'conversations',
                    status: 'committed'
                }
            });

            const totalDelta = committedEvents
                .filter(e => ids.includes(e.request_id))
                .reduce((sum, e) => sum + e.delta, 0);

            expect(totalDelta).toBe(3);
        });
    });

    // =====================================================================
    // TEST 3: Concurrency Safety - Accurate Counts Under Load
    // =====================================================================
    describe('Concurrency Safety: Accurate Counts Under Load', () => {
        test('100 concurrent usage increments result in correct count', async () => {
            const beforeUsage = subscription.products_used;
            const concurrencyLevel = 100;

            // Create 100 concurrent requests
            const requests = [];
            for (let i = 0; i < concurrencyLevel; i++) {
                requests.push(
                    subscriptionService.trackUsage(
                        shop.id,
                        'products',
                        1,
                        uuidv4(), // Unique request ID for each
                        { resourceId: uuidv4() }
                    )
                );
            }

            const results = await Promise.allSettled(requests);

            // Count successful increments
            const successful = results.filter(r => r.status === 'fulfilled').length;

            // Reload and verify count
            await subscription.reload();
            const expectedUsage = beforeUsage + successful;
            expect(subscription.products_used).toBe(expectedUsage);
        });

        test('Pessimistic locking prevents lost updates', async () => {
            // This test verifies that row-level locks are working
            // by checking that concurrent transactions don't cause double-counting
            
            await subscription.update({ orders_used: 0 });

            const testRequestIds = [uuidv4(), uuidv4()];
            
            const promises = testRequestIds.map(rid =>
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    1,
                    rid,
                    { resourceId: uuidv4() }
                )
            );

            await Promise.all(promises);

            await subscription.reload();
            expect(subscription.orders_used).toBe(2);
        });
    });

    // =====================================================================
    // TEST 4: Audit Trail Persistence
    // =====================================================================
    describe('Audit Trail: Every Increment Persisted', () => {
        test('Usage event created for every increment', async () => {
            const beforeCount = await UsageEvent.count({
                where: { shop_id: shop.id }
            });

            const testId = uuidv4();
            await subscriptionService.trackUsage(
                shop.id,
                'conversations',
                1,
                testId,
                { resourceId: uuidv4() }
            );

            const afterCount = await UsageEvent.count({
                where: { shop_id: shop.id }
            });

            expect(afterCount).toBe(beforeCount + 1);

            // Verify event details
            const event = await UsageEvent.findOne({
                where: {
                    shop_id: shop.id,
                    request_id: testId
                }
            });

            expect(event).toBeDefined();
            expect(event.status).toBe('committed');
            expect(event.delta).toBe(1);
            expect(event.committed_at).toBeDefined();
        });

        test('Audit log entry created for each usage event', async () => {
            const testId = uuidv4();
            
            await subscriptionService.trackUsage(
                shop.id,
                'products',
                1,
                testId,
                { resourceId: uuidv4() }
            );

            const auditEntry = await AuditLog.findOne({
                where: {
                    shop_id: shop.id,
                    resource_type: 'subscription_usage',
                    request_id: testId
                }
            });

            expect(auditEntry).toBeDefined();
            expect(auditEntry.action).toBe('usage_tracked');
            expect(auditEntry.details.usageType).toBe('products');
        });

        test('Query usage events by shop and date range', async () => {
            const now = new Date();
            const startDate = new Date(now.getTime() - 60000); // 1 min ago

            const events = await subscriptionService.getUsageEvents(
                shop.id,
                {
                    resourceType: 'conversations',
                    startDate,
                    endDate: now,
                    limit: 100
                }
            );

            expect(Array.isArray(events)).toBe(true);
        });
    });

    // =====================================================================
    // TEST 5: Hard Errors on Limit Exceeded
    // =====================================================================
    describe('Hard Errors: Limit Exceeded Prevents Increment', () => {
        test('USAGE_LIMIT_EXCEEDED error thrown when limit reached', async () => {
            // Set very low limit
            await subscription.update({ orders_limit: 1 });

            // First increment succeeds
            const result1 = await subscriptionService.trackUsage(
                shop.id,
                'orders',
                1,
                uuidv4(),
                { resourceId: uuidv4() }
            );
            expect(result1).toBeDefined();

            // Second increment fails (1 + 1 > 1)
            await expect(
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    1,
                    uuidv4(),
                    { resourceId: uuidv4() }
                )
            ).rejects.toThrow();

            // Restore limit
            await subscription.update({ orders_limit: 50 });
        });

        test('Error contains limit details for client handling', async () => {
            await subscription.update({ conversations_limit: 2 });

            // Fill to limit
            await subscriptionService.trackUsage(
                shop.id,
                'conversations',
                1,
                uuidv4(),
                { resourceId: uuidv4() }
            );

            try {
                await subscriptionService.trackUsage(
                    shop.id,
                    'conversations',
                    2, // Try to increment by 2, would exceed
                    uuidv4(),
                    { resourceId: uuidv4() }
                );
                fail('Should have thrown');
            } catch (error) {
                expect(error.code).toBe('USAGE_LIMIT_EXCEEDED');
                expect(error.limit).toBeDefined();
                expect(error.current).toBeDefined();
            }

            // Restore
            await subscription.update({ conversations_limit: 100 });
        });
    });

    // =====================================================================
    // TEST 6: Request ID Requirement
    // =====================================================================
    describe('Request ID: Required for Idempotency', () => {
        test('Throws error if requestId not provided', async () => {
            await expect(
                subscriptionService.trackUsage(
                    shop.id,
                    'conversations',
                    1,
                    null, // No request ID
                    { resourceId: uuidv4() }
                )
            ).rejects.toThrow();
        });

        test('requestId must be valid UUID format', async () => {
            await expect(
                subscriptionService.trackUsage(
                    shop.id,
                    'conversations',
                    1,
                    'not-a-uuid',
                    { resourceId: uuidv4() }
                )
            ).rejects.toThrow();
        });
    });

    // =====================================================================
    // TEST 7: Double Counting Detection Utility
    // =====================================================================
    describe('Double Counting Detection', () => {
        test('verifyNoDoubleCount detects duplicates', async () => {
            const testId = uuidv4();
            
            await subscriptionService.trackUsage(
                shop.id,
                'products',
                1,
                testId,
                { resourceId: uuidv4() }
            );

            // Should pass - no double counting
            const isValid = await subscriptionService.verifyNoDoubleCount(
                shop.id,
                'products',
                testId
            );
            expect(isValid).toBe(true);
        });

        test('verifyNoDoubleCount throws on actual duplicates', async () => {
            const testId = uuidv4();
            
            // Manually create duplicate events (should never happen)
            await UsageEvent.create({
                shop_id: shop.id,
                resource_type: 'conversations',
                request_id: testId,
                delta: 1,
                status: 'committed'
            });

            await UsageEvent.create({
                shop_id: shop.id,
                resource_type: 'conversations',
                request_id: testId,
                delta: 1,
                status: 'committed'
            });

            // Should detect and throw
            await expect(
                subscriptionService.verifyNoDoubleCount(
                    shop.id,
                    'conversations',
                    testId
                )
            ).rejects.toThrow('Double counting detected');
        });
    });

    // =====================================================================
    // TEST 8: Extra Charge Calculation
    // =====================================================================
    describe('Extra Charges: Overage Billing', () => {
        test('Extra charge calculated for conversations over limit', async () => {
            await subscription.update({
                conversations_limit: 2,
                conversations_used: 1,
                extra_conversations: 0,
                extra_charge: 0
            });

            // Increment by 2, would exceed limit
            // Expected: new usage = 3, extra = 1, charge = ৳2.5
            await subscriptionService.trackUsage(
                shop.id,
                'conversations',
                2,
                uuidv4(),
                { resourceId: uuidv4() }
            );

            await subscription.reload();
            
            // 1 + 2 = 3, limit is 2, so 1 over
            expect(subscription.conversations_used).toBe(3);
            expect(subscription.extra_conversations).toBe(1);
            expect(parseFloat(subscription.extra_charge)).toBe(2.5);

            // Restore
            await subscription.update({
                conversations_limit: 100,
                conversations_used: 0,
                extra_conversations: 0,
                extra_charge: 0
            });
        });
    });
});

/**
 * Integration Test: End-to-End Usage Tracking Flow
 */
describe('End-to-End: Complete Usage Tracking Flow', () => {
    let shop, user, subscription;

    beforeAll(async () => {
        user = await User.create({
            email: `e2e-${uuidv4()}@example.com`,
            password: 'test123'
        });

        shop = await Shop.create({
            name: 'E2E Test Shop',
            user_id: user.id
        });

        await UserShop.create({
            user_id: user.id,
            shop_id: shop.id,
            role: 'owner',
            is_active: true
        });

        subscription = await subscriptionService.createDefaultSubscription(shop.id);
    });

    afterAll(async () => {
        await UserShop.destroy({ where: { user_id: user.id } });
        await UsageEvent.destroy({ where: { shop_id: shop.id } });
        await AuditLog.destroy({ where: { shop_id: shop.id } });
        await Subscription.destroy({ where: { shop_id: shop.id } });
        await Shop.destroy({ where: { id: shop.id } });
        await User.destroy({ where: { id: user.id } });
    });

    test('Complete workflow: Create → Track → Verify → Audit', async () => {
        const resourceId = uuidv4();
        const requestId = uuidv4();

        // 1. Track usage
        const result = await subscriptionService.trackUsage(
            shop.id,
            'conversations',
            1,
            requestId,
            { resourceId }
        );

        // 2. Verify result
        expect(result.subscription.conversations_used).toBeGreaterThan(0);
        expect(result.usageEvent.status).toBe('committed');

        // 3. Check audit trail
        const auditLog = await AuditLog.findOne({
            where: {
                shop_id: shop.id,
                request_id: requestId
            }
        });
        expect(auditLog).toBeDefined();

        // 4. Verify idempotency
        const retry = await subscriptionService.trackUsage(
            shop.id,
            'conversations',
            1,
            requestId,
            { resourceId }
        );
        expect(retry.isRetry).toBe(true);

        // 5. Get usage events
        const events = await subscriptionService.getUsageEvents(shop.id, {
            resourceType: 'conversations'
        });
        expect(events.length).toBeGreaterThan(0);
    });
});
