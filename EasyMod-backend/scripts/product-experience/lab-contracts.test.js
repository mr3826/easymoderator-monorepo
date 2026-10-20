'use strict';

const {
    validateRunRequest,
    validatePlaygroundRequest,
    buildDatasetIndex,
    classifyOracleTurn,
} = require('./lab-contracts');
const { createCatalog } = require('./fixtures');

const makeCsv = (rows) => [
    'Persona ID,Customer Profile,Turn,Input Type,Language,Customer Message,Simulated Attachment,Hallucination Risk and Test Intent,Expected AI Truth',
    ...rows.map(row => [
        row.personaId,
        row.customerProfile || 'Synthetic profile',
        row.turn,
        row.inputType || 'Text',
        row.language || 'English',
        row.message,
        row.attachment || '',
        row.risk || 'product inquiry',
        row.expected || 'answer from current catalog evidence',
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')),
].join('\r\n');

describe('Product Engine Lab request and dataset contracts', () => {
    test('accepts only bounded baseline/candidate run scopes', () => {
        expect(validateRunRequest({ scope: 'full', mode: 'candidate' })).toEqual({ scope: 'full', mode: 'candidate' });
        expect(validateRunRequest({ scope: 'persona', personaId: 'P01', mode: 'baseline' })).toEqual({
            scope: 'persona', personaId: 'P01', mode: 'baseline',
        });
        expect(() => validateRunRequest({ scope: 'full', mode: 'shell', command: 'whoami' })).toThrow();
        expect(() => validateRunRequest({ scope: 'persona', personaId: 'P99', mode: 'candidate' })).toThrow();
        expect(() => validateRunRequest({ scope: 'full', personaId: 'P01', mode: 'candidate' })).toThrow();
    });

    test('restricts playground tenants, session identifiers, message size and image fixtures', () => {
        expect(validatePlaygroundRequest({
            tenantId: 'merchant-a',
            sessionId: 'session-0001',
            message: 'Ei panjabi-r dam koto?',
            imageFixtureId: 'fixture-shirt-front',
        }).tenantId).toBe('merchant-a');
        expect(() => validatePlaygroundRequest({ tenantId: 'production', sessionId: 'session-0001', message: 'Hi' })).toThrow();
        expect(() => validatePlaygroundRequest({ tenantId: 'merchant-a', sessionId: '../other', message: 'Hi' })).toThrow();
        expect(() => validatePlaygroundRequest({ tenantId: 'merchant-a', sessionId: 'session-0001', message: 'x'.repeat(2000) })).toThrow();
        expect(() => validatePlaygroundRequest({ tenantId: 'merchant-a', sessionId: 'session-0001', message: 'Hi', imageFixtureId: 'C:\\secret.png' })).toThrow();
    });

    test('builds safe 200-turn source index without returning raw cells', () => {
        const rows = Array.from({ length: 200 }, (_, index) => ({
            personaId: `P${String(Math.floor(index / 10) + 1).padStart(2, '0')}`,
            turn: (index % 10) + 1,
            message: `private-message-sentinel-${index}`,
        }));
        const source = Buffer.from(makeCsv(rows), 'utf8');
        const index = buildDatasetIndex(source);
        expect(index.source.personaCount).toBe(20);
        expect(index.source.scenarioCount).toBe(200);
        expect(index.personas).toHaveLength(20);
        expect(index.scenarios[0]).toMatchObject({ scenarioId: 'scenario-01-01', personaId: 'P01', turn: 1 });
        expect(JSON.stringify(index)).not.toContain('private-message-sentinel');
        expect(JSON.stringify(index)).not.toMatch(/customerMessage|customerProfile|expectedTruth|simulatedAttachment/i);
        expect(JSON.stringify(index)).not.toMatch(/sourceHash/i);
        expect(index.source.sha256).toMatch(/^[a-f0-9]{64}$/i);
    });

    test('sets eligible answerability from an independent fixture and requested fact slots', () => {
        const catalog = [...createCatalog(), {
            id: 'lab-a-synthetic-shirt', shop_id: 'fixture-shop-a', name: 'Synthetic Shirt', name_bn: 'সিনথেটিক শার্ট',
            aliases: ['synthetic t-shirt'], price: 900, quantity: 4, track_quantity: true, in_stock: true,
            is_active: true, ai_material: 'cotton', ai_color: 'white', variants: [],
        }];
        const price = classifyOracleTurn({
            message: 'How much is the synthetic shirt?', inputType: 'Text', expectedTruth: 'suggested answer is ignored',
        }, 'fixture-shop-a', catalog, null);
        expect(price).toMatchObject({
            domain: 'product', eligibility: 'ANSWERABLE', productId: 'lab-a-synthetic-shirt',
            eligibleSlots: [{ field: 'price', expectedValue: 900 }],
        });
        const unknown = classifyOracleTurn({
            message: 'Does the denim jacket use cotton?', inputType: 'Text', expectedTruth: 'it is cotton',
        }, 'fixture-shop-b', catalog, null);
        expect(unknown.eligibility).toBe('NOT_ANSWERABLE');
        expect(unknown.eligibleSlots).toEqual([]);
        expect(JSON.stringify([price, unknown])).not.toContain('suggested answer is ignored');
    });

    test('classifies scope from the customer message rather than the CSV suggested truth', () => {
        const catalog = createCatalog();
        const order = classifyOracleTurn({
            message: 'Has my order been dispatched?', inputType: 'Text', expectedTruth: 'the denim jacket costs 3200',
        }, 'fixture-shop-a', catalog, null);
        const policy = classifyOracleTurn({
            message: 'How much is the delivery fee?', inputType: 'Text', expectedTruth: 'answer with product price',
        }, 'fixture-shop-a', catalog, null);
        expect(order.domain).toBe('outside_product');
        expect(order.requiredAuthority).toBe('live_transaction_state');
        expect(policy.domain).toBe('merchant_policy');
        expect(policy.requiredAuthority).toBe('approved_merchant_policy');
    });

    test('requires real image authority for textless IMAGE_TEXT inputs', () => {
        const result = classifyOracleTurn({ message: '', inputType: 'Image + Text' }, 'fixture-shop-a', createCatalog(), null);
        expect(result).toMatchObject({ domain: 'image_dependent', eligibility: 'NOT_ANSWERABLE', requiredAuthority: 'authorized_raster_image_and_vision_provider' });
        expect(result.imageAuthority).toBe('NO_REAL_IMAGE_EVALUATED');
    });

    test('keeps every image-bearing turn outside the offline text-only answerability denominator', () => {
        const result = classifyOracleTurn({
            message: 'How much is the Test Everyday T-Shirt?',
            inputType: 'Image + Text',
        }, 'fixture-shop-a', createCatalog(), null);

        expect(result).toMatchObject({
            domain: 'image_dependent',
            eligibility: 'NOT_ANSWERABLE',
            requiredAuthority: 'authorized_raster_image_and_vision_provider',
            imageAuthority: 'NO_REAL_IMAGE_EVALUATED',
        });
        expect(result.eligibleSlots).toEqual([]);
    });
});
