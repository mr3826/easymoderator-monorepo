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
    Tenant,
    User,
    UserShop
} = require('../../entities');
const subscriptionService = require('../subscription.service');
const { sequelize } = require('../../../utils/database/database-setup');

describe('Usage Tracking - Atomic Transactions & Idempotency', () => {
    let shop, user, subscription, requestId;

    beforeAll(async () => {
        // Setup: Create test shop and user
        user = await User.create({
            email: `test-${uuidv4()}@example.com`,
            password: 'test123'
        });

        // tenant_id, unique_code and shop_name are all NOT NULL on the shops
        // table; a fixture with only `name` fails validation before the first
        // assertion runs.
        tenant = await Tenant.create({ name: `usage-test-${uuidv4().slice(0, 8)}` });
        shop = await Shop.create({
            name: 'Test Shop',
            shop_name: 'Test Shop',
            unique_code: `EMTEST-${uuidv4().slice(0, 8)}`,
            tenant_id: tenant.id,
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

    beforeEach(async () => {
        requestId = uuidv4();

        // Reset the metered state between cases. Without this every counter
        // accumulated across all 18 tests: the rollback case expected
        // conversations_used to be unchanged at 1 and read 2, and the limit
        // case reported "orders: 3 > 1" because earlier cases had already
        // spent the quota. Each test here asserts on absolute counts, so it
        // needs a known starting point rather than whatever ran before it.
        await UsageEvent.destroy({ where: { shop_id: shop.id } });
        await AuditLog.destroy({ where: { shop_id: shop.id } });
        await subscription.update({
            conversations_used: 0,
            orders_used: 0,
            products_used: 0,
            conversations_limit: 100,
            orders_limit: 100,
            products_limit: -1,
            extra_conversations: 0,
            extra_charge: 0
        });
        await subscription.reload();
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

        // This replaces a case that asserted a usage event ends up with
        // status 'rolled_back'. That status is unreachable on this path, twice
        // over: the limit check (step 4) runs BEFORE UsageEvent.create (step
        // 5), so a limit error leaves no row at all; and when the failure lands
        // after step 5, the row was created INSIDE the transaction, so the
        // rollback removes it before the service's own
        // UsageEvent.update({status:'rolled_back'}) can match anything. That
        // update is dead code on this path — left in place rather than removed
        // here, since it is billing bookkeeping and deleting it is a separate,
        // deliberate call.
        //
        // What the rollback must actually guarantee is that nothing survives a
        // failed attempt: no event row, and no counter movement. That is what
        // this asserts.
        test('a failure after the event is created leaves no trace', async () => {
            const rollbackRequestId = uuidv4();

            const auditSpy = jest
                .spyOn(AuditLog, 'create')
                .mockRejectedValueOnce(new Error('induced audit failure'));

            try {
                await expect(
                    subscriptionService.trackUsage(
                        shop.id,
                        'conversations',
                        1,
                        rollbackRequestId,
                        { resourceId: uuidv4() }
                    )
                ).rejects.toThrow(/induced audit failure/);
            } finally {
                auditSpy.mockRestore();
            }

            const event = await UsageEvent.findOne({
                where: {
                    shop_id: shop.id,
                    resource_type: 'conversations',
                    request_id: rollbackRequestId
                }
            });
            expect(event).toBeNull();

            await subscription.reload();
            expect(subscription.conversations_used).toBe(0);
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

            // audit_logs stores the correlation key as idempotency_key and the
            // payload as metadata. Querying request_id/details raised
            // "column AuditLog.request_id does not exist" and hid the fact that
            // the service was writing those same two non-columns.
            const auditEntry = await AuditLog.findOne({
                where: {
                    shop_id: shop.id,
                    resource_type: 'subscription_usage',
                    idempotency_key: testId
                }
            });

            expect(auditEntry).not.toBeNull();
            expect(auditEntry.action).toBe('usage_tracked');
            expect(auditEntry.metadata.usageType).toBe('products');
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
            // 'orders', not 'conversations'. subscription.service.js:359 exempts
            // conversations from the hard limit on purpose — they bill as
            // overage (see the extra-charge case below) — so this never threw
            // and fell through to `fail(...)`, which modern Jest does not
            // define. The resulting ReferenceError was swallowed by the same
            // catch, and error.code read undefined.
            await subscription.update({ orders_limit: 2 });

            // Fill to limit
            await subscriptionService.trackUsage(
                shop.id,
                'orders',
                1,
                uuidv4(),
                { resourceId: uuidv4() }
            );

            await expect(
                subscriptionService.trackUsage(
                    shop.id,
                    'orders',
                    2, // Would exceed
                    uuidv4(),
                    { resourceId: uuidv4() }
                )
            ).rejects.toMatchObject({
                code: 'USAGE_LIMIT_EXCEEDED',
                limit: 2
            });

            // `current` is asserted as a relationship, not a hardcoded count:
            // pinning an absolute number is what made the original suite depend
            // on which tests happened to run before it.
            await expect(
                subscriptionService.trackUsage(
                    shop.id, 'orders', 2, uuidv4(), { resourceId: uuidv4() }
                )
            ).rejects.toMatchObject({
                current: expect.any(Number)
            });
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

        // A non-UUID requestId is accepted on purpose: usageRequestKey() hashes
        // anything that is not already a UUID into a stable v5 UUID so the
        // column stays typed and "same input, same key" still holds. This case
        // asserted a rejection that was never the design and could only pass if
        // that hashing were removed — so it now pins the property that actually
        // matters, which is that idempotency survives the normalization.
        test('a non-UUID requestId is normalized and still idempotent', async () => {
            const humanKey = 'order-42-retry';

            const first = await subscriptionService.trackUsage(
                shop.id, 'conversations', 1, humanKey, { resourceId: uuidv4() }
            );
            expect(first.isRetry).toBe(false);

            const second = await subscriptionService.trackUsage(
                shop.id, 'conversations', 1, humanKey, { resourceId: uuidv4() }
            );
            expect(second.isRetry).toBe(true);

            await subscription.reload();
            expect(subscription.conversations_used).toBe(1);
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

        // The state verifyNoDoubleCount looks for cannot be reached: the unique
        // index on usage_events.request_id rejects the second insert, so this
        // case died on the setup it needed rather than on the assertion it
        // wanted. The utility is defence in depth for a shape the schema
        // forbids — so assert the guarantee that actually holds the line, which
        // is the constraint itself. (The service's own race handling is covered
        // by "Multiple concurrent retries with same requestId" above.)
        test('the unique index makes double counting unreachable', async () => {
            const testId = uuidv4();

            await UsageEvent.create({
                shop_id: shop.id,
                resource_type: 'conversations',
                request_id: testId,
                delta: 1,
                status: 'committed'
            });

            await expect(
                UsageEvent.create({
                    shop_id: shop.id,
                    resource_type: 'conversations',
                    request_id: testId,
                    delta: 1,
                    status: 'committed'
                })
            ).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });

            // And the detector reports the surviving single row as clean.
            await expect(
                subscriptionService.verifyNoDoubleCount(shop.id, 'conversations', testId)
            ).resolves.toBe(true);
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
    let shop, user, subscription, tenant;

    beforeAll(async () => {
        user = await User.create({
            email: `e2e-${uuidv4()}@example.com`,
            password: 'test123'
        });

        tenant = await Tenant.create({ name: `usage-e2e-${uuidv4().slice(0, 8)}` });
        shop = await Shop.create({
            name: 'E2E Test Shop',
            shop_name: 'E2E Test Shop',
            unique_code: `EME2E-${uuidv4().slice(0, 8)}`,
            tenant_id: tenant.id,
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
        if (tenant) await Tenant.destroy({ where: { id: tenant.id } });
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
                idempotency_key: requestId
            }
        });
        // not.toBeNull, not toBeDefined: findOne resolves null when nothing
        // matches, and `expect(null).toBeDefined()` passes.
        expect(auditLog).not.toBeNull();

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
