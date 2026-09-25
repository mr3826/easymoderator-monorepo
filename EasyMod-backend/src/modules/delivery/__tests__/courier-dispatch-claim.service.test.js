'use strict';

/**
 * Cross-provider double-booking regression.
 *
 * Before this fix, claimCourierDispatch() scoped its uniqueness to
 * (shop_id, order_id, provider), so calling it with two different providers
 * for the SAME order created two independent claim rows instead of the
 * second call being blocked. These tests exercise claimCourierDispatch()
 * directly against a fake model that mirrors real findOrCreate/update
 * semantics — rows are addressed by whatever fields the caller puts in
 * `where` — so the same defect (or fix) that a real unique index would
 * enforce shows up here without a database.
 */

const { claimCourierDispatch } = require('../courier-dispatch-claim.service');

const matches = (row, where) => Object.keys(where).every((key) => row[key] === where[key]);

const makeFakeCourierDispatchModel = () => {
    const rows = [];
    let nextId = 1;

    return {
        rows,
        findOrCreate: jest.fn(async ({ where, defaults }) => {
            const existing = rows.find((row) => matches(row, where));
            if (existing) return [existing, false];
            const created = { id: `dispatch-${nextId++}`, ...where, ...defaults };
            rows.push(created);
            return [created, true];
        }),
        update: jest.fn(async (values, { where }) => {
            let count = 0;
            for (const row of rows) {
                if (matches(row, where)) {
                    Object.assign(row, values);
                    count += 1;
                }
            }
            return [count];
        }),
        findOne: jest.fn(async ({ where }) => rows.find((row) => matches(row, where)) || null),
    };
};

describe('claimCourierDispatch cross-provider scoping', () => {
    const shopId = 'shop-1';
    const orderId = 'order-1';

    test('blocks a second, different provider from claiming the same order while the first claim is pending', async () => {
        const model = makeFakeCourierDispatchModel();

        const first = await claimCourierDispatch({
            model, shopId, orderId, provider: 'pathao', idempotencyKey: 'idem-pathao',
        });
        expect(first.state).toBe('claimed');

        const second = await claimCourierDispatch({
            model, shopId, orderId, provider: 'steadfast', idempotencyKey: 'idem-steadfast',
        });

        expect(second.state).toBe('existing');
        expect(model.rows).toHaveLength(1);
        expect(model.rows[0].provider).toBe('pathao');
    });

    test('still blocks a second attempt with the SAME provider (pre-existing protection stays intact)', async () => {
        const model = makeFakeCourierDispatchModel();

        const first = await claimCourierDispatch({
            model, shopId, orderId, provider: 'pathao', idempotencyKey: 'idem-1',
        });
        expect(first.state).toBe('claimed');

        const second = await claimCourierDispatch({
            model, shopId, orderId, provider: 'pathao', idempotencyKey: 'idem-1',
        });

        expect(second.state).toBe('existing');
        expect(model.rows).toHaveLength(1);
    });

    test('does not let a different provider re-claim a COMMITTED dispatch as a fresh booking', async () => {
        const model = makeFakeCourierDispatchModel();
        const first = await claimCourierDispatch({
            model, shopId, orderId, provider: 'pathao', idempotencyKey: 'idem-1',
        });
        await model.update(
            { status: 'COMMITTED', consignment_id: 'CN-1', tracking_code: 'TRK-1' },
            { where: { id: first.record.id, dispatch_owner_token: first.ownerToken, status: 'PENDING' } },
        );

        const second = await claimCourierDispatch({
            model, shopId, orderId, provider: 'steadfast', idempotencyKey: 'idem-2',
        });

        expect(second.state).toBe('committed');
        expect(model.rows).toHaveLength(1);
        expect(model.rows[0].provider).toBe('pathao');
        expect(model.rows[0].consignment_id).toBe('CN-1');
    });

    test('reopening a FAILED claim under a new provider refreshes the stored provider and idempotency key', async () => {
        const model = makeFakeCourierDispatchModel();
        const first = await claimCourierDispatch({
            model, shopId, orderId, provider: 'pathao', idempotencyKey: 'idem-1',
        });
        await model.update(
            { status: 'FAILED', error: 'rejected' },
            { where: { id: first.record.id, dispatch_owner_token: first.ownerToken, status: 'PENDING' } },
        );

        const reopened = await claimCourierDispatch({
            model, shopId, orderId, provider: 'steadfast', idempotencyKey: 'idem-2',
        });

        expect(reopened.state).toBe('claimed');
        expect(model.rows).toHaveLength(1);
        expect(model.rows[0].provider).toBe('steadfast');
        expect(model.rows[0].idempotency_key).toBe('idem-2');
        expect(model.rows[0].status).toBe('PENDING');
    });
});
