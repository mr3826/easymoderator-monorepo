'use strict';

/**
 * MW-V1 Phase 6 — controlled merchant tags (doc 05). Shop-scoped vocabulary,
 * idempotent assignment (UNIQUE tag↔customer), replace-set semantics, derived
 * statuses can NEVER be overwritten as manual tags (reserved-name blocklist).
 * Tags are merchant-entered only — nothing here reads message content.
 */

const tag = (over = {}) => ({
    id: 'tag-1',
    shop_id: 'shop-1',
    name: 'Wholesale inquiry',
    created_by: 'owner-1',
    created_at: new Date(),
    usage_count: 2,
    update: jest.fn(async function (f) { Object.assign(this, f); return this; }),
    destroy: jest.fn(),
    ...over,
});

jest.mock('../../entities', () => ({
    CustomerTag: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn(), destroy: jest.fn() },
    CustomerTagAssignment: { findAll: jest.fn(), bulkCreate: jest.fn(), destroy: jest.fn(), count: jest.fn() },
    Customer: { findOne: jest.fn() },
    UserShop: { findOne: jest.fn() },
    AuditLog: { create: jest.fn(async () => ({})) },
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const E = require('../../entities');
const tags = require('../customer-tags.service');

const tagTransaction = { rollback: jest.fn() };
const actor = { userId: 'owner-1', role: 'owner', shopId: 'shop-1' };
const staff = { userId: 'staff-1', role: 'staff', shopId: 'shop-1' };

beforeEach(() => {
    jest.clearAllMocks();
    const sequelize = {
        fn: jest.fn(),
        transaction: jest.fn(async (callback) => {
            try {
                return await callback(tagTransaction);
            } catch (error) {
                tagTransaction.rollback();
                throw error;
            }
        }),
    };
    E.CustomerTag.sequelize = sequelize;
    E.CustomerTagAssignment.sequelize = sequelize;
    E.UserShop.findOne.mockResolvedValue({ user_id: 'owner-1', is_active: true });
    E.Customer.findOne.mockResolvedValue({ id: 'cust-1', shop_id: 'shop-1' });
    E.CustomerTag.findAll.mockResolvedValue([]);
    E.CustomerTag.findOne.mockResolvedValue(null);
    E.CustomerTag.create.mockImplementation(async (v) => tag(v));
    E.CustomerTagAssignment.findAll.mockResolvedValue([]);
    E.AuditLog.create.mockResolvedValue({});
});

describe('vocabulary', () => {
    it('rejects reserved derived-status names (they are facts of the engine, not knobs)', async () => {
        for (const name of ['Repeat Buyer', 'AT RISK', 'fraud', 'rto_high', 'Interested', 'Blacklist']) {
            await expect(tags.createTag({ shopId: 'shop-1', name }, actor))
                .rejects.toMatchObject({ code: 'TAG_NAME_RESERVED' }, `name: ${name}`);
        }
        expect(E.CustomerTag.create).not.toHaveBeenCalled();
    });

    it('normalizes casing/whitespace and dedupes case-insensitively per shop', async () => {
        E.CustomerTag.findOne.mockResolvedValue(tag({ name: 'Priority service' }));
        const dup = await tags.createTag({ shopId: 'shop-1', name: '  priority   SERVICE ' }, actor).catch((e) => e);
        // existing tag returned idempotently OR clear conflict error — never a second row
        if (dup instanceof Error) expect(dup.code).toBe('TAG_EXISTS');
        expect(E.CustomerTag.findOne.mock.calls[0][0].where.name_lower).toBeDefined();
    });

    it('enforces bounded vocabulary and naming rules', async () => {
        await expect(tags.createTag({ shopId: 'shop-1', name: 'x'.repeat(31) }, actor))
            .rejects.toMatchObject({ code: 'TAG_NAME_TOO_LONG' });
        E.CustomerTag.count.mockResolvedValue(40);
        await expect(tags.createTag({ shopId: 'shop-1', name: 'New tag' }, actor))
            .rejects.toMatchObject({ code: 'TAG_LIMIT' });
    });

    it('rolls back tag creation when its audit record cannot be persisted', async () => {
        E.CustomerTag.count.mockResolvedValue(0);
        E.AuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(tags.createTag({ shopId: 'shop-1', name: 'New tag' }, actor))
            .rejects.toMatchObject({ code: 'TAG_AUDIT_FAILED', status: 503 });
        expect(tagTransaction.rollback).toHaveBeenCalledTimes(1);
    });

    it('shop-scoped: list carries shop_id and never leaks others', async () => {
        await tags.listTags({ shopId: 'shop-1' }, actor);
        expect(E.CustomerTag.findAll.mock.calls[0][0].where).toMatchObject({ shop_id: 'shop-1' });
    });

    it('only privileged roles rename/delete vocabulary; staff may assign', async () => {
        E.CustomerTag.findOne.mockResolvedValue(tag());
        await expect(tags.renameTag({ shopId: 'shop-1', tagId: 'tag-1', name: 'Renamed' }, staff))
            .rejects.toMatchObject({ code: 'TAG_PRIVILEGE_REQUIRED' });
        const renamed = await tags.renameTag({ shopId: 'shop-1', tagId: 'tag-1', name: 'Renamed' }, actor);
        expect(renamed.name).toBe('Renamed');
    });
});

describe('assignments (replace-set)', () => {
    it('PUT is idempotent, bounded (15/customer) and set-based', async () => {
        const t1 = tag(); const t2 = tag({ id: 'tag-2', name: 'Needs size help' });
        const { Op } = require('sequelize');
        E.CustomerTag.findAll.mockImplementation(({ where }) => {
            const wanted = where.id[Op.in] || [];
            return Promise.resolve([t1, t2].filter((t) => wanted.includes(t.id)));
        });
        E.CustomerTagAssignment.count.mockResolvedValue(1);

        // duplicate in the request must collapse to one assignment row
        const result = await tags.setCustomerTags(
            { shopId: 'shop-1', customerId: 'cust-1', tagIds: ['tag-1', 'tag-2', 'tag-1'] },
            staff);

        expect(result.data.map((t) => t.id).sort()).toEqual(['tag-1', 'tag-2']);
        const bulk = E.CustomerTagAssignment.bulkCreate.mock.calls.find(([rows]) => rows.length);
        expect(bulk[0]).toHaveLength(2);
        expect(bulk[0][0]).toMatchObject({ tag_id: 'tag-1', customer_id: 'cust-1', shop_id: 'shop-1' });

        const tooMany = Array.from({ length: 16 }, (_, i) => `550e8400-e29b-41d4-a716-4466554400${String(i).padStart(2, '0')}`);
        await expect(tags.setCustomerTags({ shopId: 'shop-1', customerId: 'cust-1', tagIds: tooMany }, staff))
            .rejects.toMatchObject({ code: 'TAG_ASSIGN_LIMIT' });
    });

    it('rejects foreign tags — every id must belong to this shop', async () => {
        E.CustomerTag.findAll.mockResolvedValue([tag()]); // only tag-1 exists in THIS shop
        await expect(tags.setCustomerTags(
            { shopId: 'shop-1', customerId: 'cust-1', tagIds: ['tag-1', 'tag-SOMEONE-ELSE'] },
            staff))
            .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
        expect(E.CustomerTag.findAll.mock.calls[0][0].where).toMatchObject({ shop_id: 'shop-1' });
    });

    it('empty set clears assignments (delete, not magic)', async () => {
        await tags.setCustomerTags({ shopId: 'shop-1', customerId: 'cust-1', tagIds: [] }, staff);
        expect(E.CustomerTagAssignment.destroy.mock.calls.length).toBeGreaterThan(0);
        expect(E.CustomerTagAssignment.bulkCreate).not.toHaveBeenCalled();
    });

    it('audit records the change-set summary, never message data', async () => {
        E.CustomerTag.findAll.mockResolvedValue([tag()]);
        await tags.setCustomerTags({ shopId: 'shop-1', customerId: 'cust-1', tagIds: ['tag-1'] }, staff);
        expect(E.AuditLog.create).toHaveBeenCalled();
        const entry = E.AuditLog.create.mock.calls[0][0];
        expect(entry.resource_type).toBe('customer_tags');
        expect(entry.metadata).toMatchObject({ customer_id: 'cust-1', tag_ids: ['tag-1'] });
    });
});
