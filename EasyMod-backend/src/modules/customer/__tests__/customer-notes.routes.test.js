'use strict';

const express = require('express');
const request = require('supertest');

const mockAuthenticate = jest.fn((req, _res, next) => {
    req.user = { userId: 'staff-9', shopId: 'shop-1', role: 'staff', full_name: 'Nowrin Sultana' };
    next();
});

jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: mockAuthenticate,
    checkSubscriptionStatus: (_req, _res, next) => next(),
}));
jest.mock('../../audit/idempotency.middleware', () => ({
    idempotencyMiddleware: (_req, _res, next) => next(),
}));
jest.mock('../../audit/audit.middleware', () => ({
    auditLogMiddleware: () => (_req, _res, next) => next(),
}));
jest.mock('../customer.controller', () => new Proxy({}, {
    get: () => jest.fn((_req, res) => res.json({ success: true })),
    has: () => true,
}));
jest.mock('../customer-memory.service', () => ({
    getCustomerMemory: jest.fn(), getPersonalizationContext: jest.fn(),
}));

const mockNotesService = {
    listNotes: jest.fn(async () => ({ data: [], total: 0 })),
    createNote: jest.fn(async ({ body }) => ({
        id: 'note-1', shop_id: 'shop-1', customer_id: 'cust-1', body,
        author_id: 'staff-9', author_name: 'Nowrin Sultana',
        created_at: '2026-10-25T09:00:00Z', updated_at: '2026-10-25T09:00:00Z',
    })),
    updateNote: jest.fn(async () => {
        const err = new Error('Only the note author (or an owner/admin) can edit a note');
        err.code = 'NOTE_NOT_AUTHOR'; err.statusCode = 403;
        throw err;
    }),
    deleteNote: jest.fn(async () => ({ id: 'note-1', deleted: true })),
};
jest.mock('../customer-notes.service', () => mockNotesService);

const routes = require('../customer.routes');
const { globalErrorHandler } = require('../../../utils/AppError');

const app = express();
app.use(express.json());
app.use('/api/customer', routes);
app.use(globalErrorHandler);

const CUST = '550e8400-e29b-41d4-a716-446655440000';
const NOTE = '660e8400-e29b-41d4-a716-446655440001';

describe('customer notes routes (MW-V1)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('GET returns the service page and derives shop+actor from the JWT only', async () => {
        const res = await request(app).get(`/api/customer/${CUST}/notes`);
        expect(res.status).toBe(200);
        expect(mockNotesService.listNotes.mock.calls[0][0]).toMatchObject({ shopId: 'shop-1', customerId: CUST });
        expect(mockNotesService.listNotes.mock.calls[0][1]).toMatchObject({ userId: 'staff-9', role: 'staff' });
    });

    it('POST creates with 201', async () => {
        const res = await request(app).post(`/api/customer/${CUST}/notes`).send({ body: 'morning calls preferred' });
        expect(res.status).toBe(201);
        expect(res.data ?? res.body).toMatchObject({ success: true, data: { author_name: 'Nowrin Sultana' } });
    });

    it('POST rejects a non-uuid customer id before touching the service', async () => {
        const res = await request(app).post('/api/customer/not-a-uuid/notes').send({ body: 'x' });
        expect(res.status).toBe(400);
        expect(mockNotesService.createNote).not.toHaveBeenCalled();
    });

    it('POST rejects an empty body (route validator)', async () => {
        const res = await request(app).post(`/api/customer/${CUST}/notes`).send({ body: '' });
        expect(res.status).toBe(400);
        expect(mockNotesService.createNote).not.toHaveBeenCalled();
    });

    it('service 403 author rule surfaces as 403 with stable code', async () => {
        const res = await request(app).patch(`/api/customer/${CUST}/notes/${NOTE}`).send({ body: 'edited' });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'NOTE_NOT_AUTHOR' } });
    });

    it('DELETE soft-deletes via the service', async () => {
        const res = await request(app).delete(`/api/customer/${CUST}/notes/${NOTE}`);
        expect(res.status).toBe(200);
        expect(mockNotesService.deleteNote).toHaveBeenCalled();
    });
});
