'use strict';

jest.mock('../../modules/growth-os/growth-os.prospect.service', () => ({
    createImported: jest.fn(),
}));

const {
    crmImportRow,
    partnerImportRow,
} = require('../import-growth-prospects');

describe('growth prospect import transformations', () => {
    const shop = (settings, isActive = true) => ({
        id: 'shop-1', name: 'Evidence Shop', shop_name: 'Evidence Shop', is_active: isActive, settings,
    });

    test('attaches activation evidence only for converted rows backed by a first AI reply', () => {
        const row = crmImportRow({
            id: 'audit-1',
            shop_id: 'shop-1',
            idempotency_key: 'crm:key-a',
            metadata: { lead_source: 'signup', business_name: 'Evidence Co', status: 'converted' },
            created_at: new Date('2026-08-01T00:00:00.000Z'),
        }, null, shop({ first_ai_reply: { occurred_at: '2026-09-05T10:00:00.000Z' } }));

        expect(row.data.status).toBe('converted');
        expect(row.activationEvidenceAt).toBe('2026-09-05T10:00:00.000Z');
    });

    test('converts without evidence stay event-less instead of synthesizing activation', () => {
        const row = crmImportRow({
            id: 'audit-2',
            shop_id: 'shop-1',
            idempotency_key: 'crm:key-b',
            metadata: { lead_source: 'signup', business_name: 'Bare Co', status: 'converted' },
            created_at: new Date('2026-08-01T00:00:00.000Z'),
        }, null, shop({}));

        expect(row.data.status).toBe('converted');
        expect(row.activationEvidenceAt).toBeNull();
    });

    test('inactive linked shops never imply conversion or evidence', () => {
        const row = partnerImportRow({
            id: 'partner-1',
            shop_id: 'shop-1',
            business_name: 'Inactive Shop Co',
            phone: '01700000201',
            page_link: 'https://facebook.com/inactive-shop',
            status: 'pending',
            notes: null,
            created_at: new Date('2026-08-01T00:00:00.000Z'),
        }, null, shop({ first_ai_reply: { occurred_at: '2026-09-05T10:00:00.000Z' } }, false));

        expect(row.data.status).not.toBe('converted');
        expect(row.activationEvidenceAt).toBeNull();
    });

    test('partner rows carry evidence when the application maps to an evidenced converted row', () => {
        const row = partnerImportRow({
            id: 'partner-2',
            shop_id: 'shop-1',
            business_name: 'Partner Evidence Co',
            phone: '01700000202',
            page_link: 'https://facebook.com/partner-evidence',
            status: 'approved',
            notes: null,
            created_at: new Date('2026-08-01T00:00:00.000Z'),
        }, null, shop({ first_ai_reply: { occurred_at: '2026-09-06T09:30:00.000Z' } }));

        expect(row.data.status).toBe('converted');
        expect(row.activationEvidenceAt).toBe('2026-09-06T09:30:00.000Z');
    });
});
