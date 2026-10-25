'use strict';

/**
 * MW-V1 Phase 5 — CRM Lite internal customer notes (doc 05 contract).
 * Notes are staff-private, merchant-entered, audited by reference (never body
 * text in audit payloads), shop-scoped, and never reach the customer, the AI
 * prompt context, or SSE payloads.
 */

const note = (over = {}) => ({
    id: 'note-1',
    shop_id: 'shop-1',
    customer_id: 'cust-1',
    body: 'Prefers morning courier calls',
    author_id: 'staff-1',
    author_name: 'Nowrin',
    created_at: new Date('2026-10-25T09:00:00Z'),
    updated_at: new Date('2026-10-25T09:00:00Z'),
    deletedAt: null,
    destroy: jest.fn(),
    update: jest.fn(async function (f) { Object.assign(this, f); return this; }),
    ...over,
});

jest.mock('../../entities', () => ({
    CustomerNote: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn() },
    Customer: { findOne: jest.fn() },
    UserShop: { findOne: jest.fn() },
    AuditLog: { create: jest.fn(async () => ({})) },
}));
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const E = require('../../entities');
const notes = require('../customer-notes.service');

const actor = { userId: 'staff-1', role: 'staff', shopId: 'shop-1' };
const owner = { userId: 'owner-1', role: 'owner', shopId: 'shop-1' };

beforeEach(() => {
    jest.clearAllMocks();
    E.Customer.findOne.mockResolvedValue({ id: 'cust-1', shop_id: 'shop-1' });
    E.UserShop.findOne.mockResolvedValue({ user_id: actor.userId, is_active: true });
    E.AuditLog.create.mockResolvedValue({});
});

describe('create', () => {
    it('requires a non-empty body within the size limit', async () => {
        await expect(notes.createNote({ shopId: 'shop-1', customerId: 'cust-1', body: '   ' }, actor))
            .rejects.toMatchObject({ code: 'NOTE_BODY_REQUIRED' });
        await expect(notes.createNote({ shopId: 'shop-1', customerId: 'cust-1', body: 'x'.repeat(2001) }, actor))
            .rejects.toMatchObject({ code: 'NOTE_TOO_LONG' });
        expect(E.CustomerNote.create).not.toHaveBeenCalled();
    });

    it('binds note to the shop AND the shop-owned customer (rejects foreign customer)', async () => {
        E.Customer.findOne.mockResolvedValue(null); // cust not in this shop
        await expect(notes.createNote({ shopId: 'shop-1', customerId: 'cust-Z', body: 'ok' }, actor))
            .rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
        // association check carries BOTH ids — never customer id alone
        expect(E.Customer.findOne.mock.calls[0][0].where).toMatchObject({ id: 'cust-Z', shop_id: 'shop-1' });
    });

    it('stores trimmed body with author identity snapshot and audits by reference only', async () => {
        E.CustomerNote.create.mockResolvedValue(note({ body: 'asked for size confirmation before dispatch' }));
        const result = await notes.createNote(
            { shopId: 'shop-1', customerId: 'cust-1', body: '  asked for size confirmation before dispatch  ' },
            actor);

        expect(result.body).toBe('asked for size confirmation before dispatch');
        const created = E.CustomerNote.create.mock.calls[0][0];
        expect(created.shop_id).toBe('shop-1');
        expect(created.customer_id).toBe('cust-1');
        expect(created.author_id).toBe('staff-1');
        expect(created.author_name).toBeTruthy();

        expect(E.AuditLog.create).toHaveBeenCalledTimes(1);
        const audit = E.AuditLog.create.mock.calls[0][0];
        expect(audit.resource_type).toBe('customer_note');
        expect(audit.action).toBe('CREATE');
        // PII/content discipline: audit references ids + length, never the body text
        expect(JSON.stringify(audit)).not.toContain('size confirmation');
        expect(audit.metadata.body_length).toBe(43);
    });
});

describe('list', () => {
    it('is newest-first, shop+customer scoped, excludes soft-deleted, bounded', async () => {
        E.CustomerNote.findAll.mockResolvedValue([note()]);
        E.CustomerNote.count.mockResolvedValue(1);

        const { data, total } = await notes.listNotes({ shopId: 'shop-1', customerId: 'cust-1', limit: 500 }, actor);

        expect(total).toBe(1);
        expect(data[0].id).toBe('note-1');
        const where = E.CustomerNote.findAll.mock.calls[0][0].where;
        expect(where).toMatchObject({ shop_id: 'shop-1', customer_id: 'cust-1', deletedAt: null });
        expect(E.CustomerNote.findAll.mock.calls[0][0].limit).toBeLessThanOrEqual(100);
        expect(E.CustomerNote.findAll.mock.calls[0][0].order[0][0]).toBe('created_at');
    });
});

describe('update', () => {
    it('author may edit; another staff may not; owner/admin may correct', async () => {
        E.CustomerNote.findOne.mockResolvedValue(note({ author_id: 'staff-1' }));
        await expect(notes.updateNote({ shopId: 'shop-1', noteId: 'note-1', body: 'changed' },
            { userId: 'staff-2', role: 'staff', shopId: 'shop-1' }))
            .rejects.toMatchObject({ code: 'NOTE_NOT_AUTHOR' });

        E.CustomerNote.findOne.mockResolvedValue(note({ author_id: 'staff-1' }));
        const edited = await notes.updateNote({ shopId: 'shop-1', noteId: 'note-1', body: 'corrected' }, owner);
        expect(edited.body).toBe('corrected');
    });

    it('re-fetches within shop scope — a foreign shop can never touch the row', async () => {
        E.CustomerNote.findOne.mockResolvedValue(null);
        await expect(notes.updateNote({ shopId: 'shop-2', noteId: 'note-1', body: 'nope' },
            { userId: 'x', role: 'owner', shopId: 'shop-2' }))
            .rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
        expect(E.CustomerNote.findOne.mock.calls[0][0].where).toMatchObject({ id: 'note-1', shop_id: 'shop-2' });
    });
});

describe('delete', () => {
    it('soft-deletes for the author (paranoid destroy, retention-visible), writes the audit reference', async () => {
        const n = note({ author_id: 'staff-1' });
        E.CustomerNote.findOne.mockResolvedValue(n);

        await notes.deleteNote({ shopId: 'shop-1', noteId: 'note-1' }, actor);

        expect(n.destroy).toHaveBeenCalled(); // paranoid = soft delete
        expect(E.AuditLog.create).toHaveBeenCalledTimes(1);
        expect(E.AuditLog.create.mock.calls[0][0].action).toBe('DELETE');
    });
});

describe('non-exposure invariants', () => {
    it('serialize output contains no customer PII beyond ids and author name', async () => {
        E.CustomerNote.findAll.mockResolvedValue([note()]);
        E.CustomerNote.count.mockResolvedValue(1);
        const { data } = await notes.listNotes({ shopId: 'shop-1', customerId: 'cust-1' }, actor);
        expect(Object.keys(data[0]).sort()).toEqual(
            ['author_id', 'author_name', 'body', 'created_at', 'customer_id', 'id', 'shop_id', 'updated_at'].sort());
    });
});
