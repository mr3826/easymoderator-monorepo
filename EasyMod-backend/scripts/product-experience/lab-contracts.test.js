'use strict';

const {
    validateRunRequest,
    validatePlaygroundRequest,
    buildDatasetIndex,
    classifyOracleTurn,
    createOracleContextTracker,
} = require('./lab-contracts');
const { createCatalog } = require('./fixtures');
const { createV12Catalog } = require('./catalog-fixtures-v1-2');

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

    test.each([
        ['How long does delivery take to Bogra?', 'merchant_policy', 'approved_merchant_policy'],
        ['Will the two products arrive together or separately?', 'merchant_policy', 'approved_merchant_policy'],
        ['Do you require advance payment?', 'merchant_policy', 'approved_merchant_policy'],
        ['Which courier do you use?', 'merchant_policy', 'approved_merchant_policy'],
        ['Where is my parcel now?', 'outside_product', 'live_transaction_state'],
        ['Has my parcel been dispatched?', 'outside_product', 'live_transaction_state'],
    ])('separates merchant policy from live parcel state: %s', (message, domain, requiredAuthority) => {
        const result = classifyOracleTurn({ message, inputType: 'Text' }, 'fixture-shop-a', createCatalog(), null);
        expect(result).toMatchObject({ domain, requiredAuthority, eligibility: 'NOT_ANSWERABLE', eligibleSlots: [] });
    });

    test('does not treat invoice or consignment availability as catalog stock', () => {
        const product = {
            id: 'fixture-shirt', shop_id: 'fixture-shop-a', name: 'Test Everyday T-Shirt',
            is_active: true, price: 900, currency: 'BDT', quantity: 2, track_quantity: true, variants: [],
        };
        const result = classifyOracleTurn({
            message: 'Is my invoice or consignment available yet?', inputType: 'Text',
        }, 'fixture-shop-a', [product], product.id);

        expect(result).toMatchObject({
            domain: 'outside_product',
            requiredAuthority: 'live_transaction_state',
            eligibility: 'NOT_ANSWERABLE',
            eligibleSlots: [],
            classificationTags: ['transaction_or_live_state'],
        });
    });

    test('requires real image authority for textless IMAGE_TEXT inputs', () => {
        const result = classifyOracleTurn({ message: '', inputType: 'Image + Text' }, 'fixture-shop-a', createCatalog(), null);
        expect(result).toMatchObject({ domain: 'image_dependent', eligibility: 'NOT_ANSWERABLE', requiredAuthority: 'authorized_raster_image_and_vision_provider' });
        expect(result.imageAuthority).toBe('NO_REAL_IMAGE_EVALUATED');
    });

    test('scores catalog facts from text even when simulator pixels are unavailable', () => {
        const result = classifyOracleTurn({
            message: 'What is the price of Olive Cargo Pant?',
            inputType: 'Image + Text',
            simulatedAttachment: '[Image 1: USD 5]',
        }, 'fixture-shop-a', createV12Catalog(), null);

        expect(result).toMatchObject({
            domain: 'product',
            eligibility: 'ANSWERABLE',
            productId: 'v12-a-cargo',
            eligibleSlots: [expect.objectContaining({ field: 'price', expectedValue: 1450, currency: 'BDT' })],
        });
        expect(JSON.stringify(result)).not.toMatch(/USD|500/);
    });
});

describe('V1.2 independent catalog oracle', () => {
    const simple = (overrides = {}) => ({
        id: 'simple', shop_id: 'fixture-shop-a', name: 'Synthetic Coat', is_active: true,
        price: 1200, currency: 'BDT', quantity: 3, track_quantity: true, variants: [], ...overrides,
    });
    const evaluate = (message, catalog = [simple()], extra = {}) => classifyOracleTurn({ message, inputType: 'Text', ...extra }, 'fixture-shop-a', catalog);

    test('carries product context from source customer turns only', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-a-panjabi');
        const tracker = createOracleContextTracker(product.shop_id, catalog);
        const first = { message: `What is the price of ${product.name}?`, inputType: 'Text' };
        expect(classifyOracleTurn(first, product.shop_id, catalog, tracker.currentProductId()).eligibleSlots)
            .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'price', expectedValue: product.price })]));
        tracker.observeSourceTurn(first);
        expect(tracker.currentProductId()).toBe(product.id);
        const followup = { message: 'Is size 40 in stock?', inputType: 'Text' };
        expect(classifyOracleTurn(followup, product.shop_id, catalog, tracker.currentProductId()).productId).toBe(product.id);
        tracker.observeSourceTurn({ message: 'Thanks, I will think about it.', inputType: 'Text' });
        expect(tracker.currentProductId()).toBe(product.id);
        tracker.observeSourceTurn({ message: 'What is the jacket price?', inputType: 'Text' });
        expect(tracker.currentProductId()).toBeNull();
    });

    test('clears oracle context when a customer switches to a different explicit product category', () => {
        const catalog = createV12Catalog();
        const cargo = catalog.find(item => item.id === 'v12-a-cargo');
        const tracker = createOracleContextTracker(cargo.shop_id, catalog);
        tracker.observeSourceTurn({ message: `What is the price of ${cargo.name}?`, inputType: 'Text' });
        expect(tracker.currentProductId()).toBe(cargo.id);

        tracker.observeSourceTurn({
            message: 'Does the white T-shirt come with the model as a combo?', inputType: 'Text',
        });
        expect(tracker.currentProductId()).toBeNull();
    });

    test('clears unidentified image context and accepts a product named in image text', () => {
        const catalog = createV12Catalog();
        const kamiz = catalog.find(item => item.id === 'v12-b-kamiz');
        const panjabi = catalog.find(item => item.id === 'v12-b-panjabi');
        const tracker = createOracleContextTracker(kamiz.shop_id, catalog);
        tracker.observeSourceTurn({ message: `What is the price of ${kamiz.name}?`, inputType: 'Text' });
        expect(tracker.currentProductId()).toBe(kamiz.id);

        tracker.observeSourceTurn({ message: '', inputType: 'Image' });
        expect(tracker.currentProductId()).toBeNull();

        tracker.observeSourceTurn({ message: `Can you show me this ${panjabi.name}?`, inputType: 'Image + Text' });
        expect(tracker.currentProductId()).toBe(panjabi.id);
    });

    test.each([
        ['garment length', 'Size 34 lagbe. Length koto 34 size er?', 'garment_measurement'],
        ['body measurements', 'Size L er chest and waist size koto inch?', 'body_size_fit'],
    ])('does not misclassify %s questions as price requests', (_label, message, unsupportedField) => {
        const cargo = createV12Catalog().find(item => item.id === 'v12-b-cargo');
        const result = classifyOracleTurn({ message, inputType: 'Text' }, cargo.shop_id, createV12Catalog(), cargo.id);

        expect(result.eligibleSlots.some(slot => slot.field === 'price')).toBe(false);
        expect(result.unknownRequestedFields).toContain(unsupportedField);
    });

    test('keeps garment-length questions out of variant and catalog answer scoring', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-b-cargo');
        const result = classifyOracleTurn({
            message: 'Size 34 lagbe. Length koto 34 size er?', inputType: 'Text',
        }, product.shop_id, catalog, product.id);

        expect(result).toMatchObject({
            eligibility: 'NOT_ANSWERABLE',
            productId: product.id,
            selectedVariantId: null,
            variantResolution: 'NOT_REQUESTED',
            eligibleSlots: [],
        });
        expect(result.unknownRequestedFields).toContain('garment_measurement');
        expect(result.unknownRequestedFields).not.toContain('variant');
    });

    test('classifies a Bangla fixed-price offer as merchant policy and keeps source product context', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-b-kamiz');
        const tracker = createOracleContextTracker(product.shop_id, catalog);
        tracker.observeSourceTurn({ message: `What is the price of ${product.name}?`, inputType: 'Text' });
        const offer = {
            message: 'একদাম ১২০০ টাকা রাখলে কনফার্ম করি। নাহলে অন্য পেইজে দেখবো।', inputType: 'Text',
        };
        const result = classifyOracleTurn(offer, product.shop_id, catalog, tracker.currentProductId());

        expect(result).toMatchObject({
            domain: 'merchant_policy',
            requiredAuthority: 'approved_merchant_policy',
            eligibility: 'NOT_ANSWERABLE',
            eligibleSlots: [],
            classificationTags: ['merchant_policy'],
        });
        tracker.observeSourceTurn(offer);
        expect(tracker.currentProductId()).toBe(product.id);
    });

    test('does not carry a women\'s garment into an explicit trousers or leggings query', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-b-kamiz');
        const tracker = createOracleContextTracker(product.shop_id, catalog);
        tracker.observeSourceTurn({ message: `What is the price of ${product.name}?`, inputType: 'Text' });
        const query = { message: 'মেয়েদের কোনো ট্রাউজার বা লেগিংস আছে?', inputType: 'Text' };
        const result = classifyOracleTurn(query, product.shop_id, catalog, tracker.currentProductId());

        expect(result.eligibility).toBe('NOT_ANSWERABLE');
        expect(result.productId).toBeNull();
        expect(result.eligibleSlots).toEqual([]);
        tracker.observeSourceTurn(query);
        expect(tracker.currentProductId()).toBeNull();
    });

    test.each([
        'Total bill koto ashlo?',
        'Payment cash on delivery korbo. Total amount koto bolen?',
        'Order confirm hoise kina janaben.',
    ])('keeps order totals and status under live transaction authority: %s', message => {
        const panjabi = createV12Catalog().find(item => item.id === 'v12-b-panjabi');
        const result = classifyOracleTurn({ message, inputType: 'Text' }, panjabi.shop_id, createV12Catalog(), panjabi.id);

        expect(result).toMatchObject({
            domain: 'outside_product',
            requiredAuthority: 'live_transaction_state',
            eligibility: 'NOT_ANSWERABLE',
            eligibleSlots: [],
        });
    });

    test.each([null, undefined, '', '   ', false, true, NaN, Infinity, -1, {}, []])('missing or invalid price %p never becomes a zero-price fact', (price) => {
        const result = evaluate('What is the price of Synthetic Coat?', [simple({ price })]);
        expect(result.eligibleSlots).toEqual([]);
        expect(result.unknownRequestedFields).toContain('price');
    });

    test('real zero and finite decimal strings remain authoritative prices', () => {
        for (const [price, expectedValue] of [[0, 0], ['1200.50', 1200.5]]) {
            expect(evaluate('What is the price of Synthetic Coat?', [simple({ price })]).eligibleSlots)
                .toEqual([expect.objectContaining({ field: 'price', expectedValue, currency: 'BDT' })]);
        }
    });

    test.each([null, undefined, '', false, NaN, Infinity, -1, 1.5])('invalid tracked quantity %p remains unknown despite a stock flag', (quantity) => {
        const result = evaluate('Is Synthetic Coat in stock?', [simple({ quantity, in_stock: true })]);
        expect(result.eligibleSlots).toEqual([]);
        expect(result.unknownRequestedFields).toContain('stock');
    });

    test('untracked boolean availability is authoritative without claiming a quantity', () => {
        expect(evaluate('Is Synthetic Coat in stock?', [simple({ track_quantity: false, quantity: null, in_stock: false })]).eligibleSlots)
            .toEqual([expect.objectContaining({ field: 'stock', expectedValue: 'OUT_OF_STOCK' })]);
    });

    test.each(['kamiz', 'panjabi', 'cargo', 'denim'])('resolves a complete %s SKU across duplicate tenant titles', (family) => {
        const catalog = createV12Catalog();
        const size = ({ kamiz: 'M', panjabi: '40', cargo: '32', denim: 'M' })[family];
        for (const tenant of ['a', 'b']) {
            const product = catalog.find(item => item.id === `v12-${tenant}-${family}`);
            const result = classifyOracleTurn({ message: `What is the price and stock of ${product.name} size ${size} color ${product.verifiedColor}?`, inputType: 'Text' }, product.shop_id, catalog);
            expect(result.selectedVariantId).toBe(`v12-${tenant}-${family}-${size.toLocaleLowerCase()}`);
            expect(result.eligibleSlots).toEqual(expect.arrayContaining([
                expect.objectContaining({ field: 'price', expectedValue: product.price }),
                expect.objectContaining({ field: 'variant_stock', expectedValue: tenant === 'a' ? 'IN_STOCK' : 'OUT_OF_STOCK' }),
            ]));
            expect(result.eligibleSlots.every(slot => slot.evidenceId.startsWith(product.id))).toBe(true);
        }
    });

    test('does not choose the first SKU when only size identifies multiple colors', () => {
        const result = evaluate('What is the price of Synthetic Coat size M?', [simple({ variants: [
            { id: 'm-lavender', size: 'M', color: 'lavender', price: 1200, quantity: 2, is_active: true },
            { id: 'm-mauve', size: 'M', color: 'mauve', price: 1200, quantity: 1, is_active: true },
        ] })]);
        expect(result.selectedVariantId).toBeNull();
        expect(result.eligibleSlots).toEqual([]);
        expect(result.variantResolution).toBe('AMBIGUOUS');
    });

    test('missing size/color combinations and unknown sizes cannot inherit parent facts', () => {
        for (const selection of ['size L color navy', 'size XXXL color maroon', 'size L color pink']) {
            const result = evaluate(`What is the price and stock of Embroidered Kamiz ${selection}?`, createV12Catalog());
            expect(result.selectedVariantId).toBeNull();
            expect(result.eligibleSlots).toEqual([]);
            expect(result.variantResolution).toBe('NOT_FOUND');
        }
    });

    test('duplicate complete SKUs remain ambiguous regardless of array order', () => {
        const variants = [
            { id: 'first', size: 'M', color: 'Red', price: 1200, quantity: 1 },
            { id: 'second', size: 'M', color: 'Red', price: 1800, quantity: 0 },
        ];
        for (const ordered of [variants, [...variants].reverse()]) {
            const result = evaluate('What is the price and stock of Synthetic Coat size M color Red?', [simple({ variants: ordered })]);
            expect(result).toMatchObject({ selectedVariantId: null, variantResolution: 'AMBIGUOUS', eligibleSlots: [] });
        }
    });

    test('unique flat variants still use their explicit price and quantity', () => {
        const variants = [{ id: 'flat-xl', option_name: 'Size', option_value: 'XL', price: '1250.50', quantity: '0' }];
        const result = evaluate('What is the price and stock of Synthetic Coat XL size?', [simple({ variants })]);
        expect(result.selectedVariantId).toBe('flat-xl');
        expect(result.eligibleSlots).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'price', expectedValue: 1250.5 }),
            expect.objectContaining({ field: 'variant_stock', expectedValue: 'OUT_OF_STOCK' }),
        ]));
    });

    test('a variant with null price inherits the parent price while unknown stock stays unknown', () => {
        const result = evaluate('What is the price and stock of Embroidered Kamiz size L color lavender?', createV12Catalog());
        expect(result.selectedVariantId).toBe('v12-a-kamiz-l');
        expect(result.eligibleSlots).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'price', expectedValue: 1850 }),
        ]));
        expect(result.eligibleSlots.some(slot => slot.field === 'variant_stock')).toBe(false);
        expect(result.unknownRequestedFields).toContain('stock');
    });

    test('independent flat size/color entries never establish a SKU combination', () => {
        const variants = [
            { id: 'size-m', option_name: 'Size', option_value: 'M', price: 1200, quantity: 2 },
            { id: 'color-red', option_name: 'Color', option_value: 'Red', price: 1200, quantity: 2 },
        ];
        const result = evaluate('What is the price and stock of Synthetic Coat size M color Red?', [simple({ variants })]);
        expect(result.selectedVariantId).toBeNull();
        expect(result.eligibleSlots).toEqual([]);
    });

    test('foreign currency and unverified or invalid attributes are not BDT/catalog facts', () => {
        const product = simple({ currency: 'USD', verifiedMaterial: true, verifiedColor: '   ', ai_material: 'cotton' });
        expect(evaluate('What is the price, material and color of Synthetic Coat?', [product]).eligibleSlots).toEqual([]);
    });

    test('AI-derived material metadata is not an independently verified material answer', () => {
        const product = simple({ verifiedMaterial: 'cotton', ai_material: 'cotton' });
        const result = evaluate('What material is Synthetic Coat made of?', [product]);
        expect(result.eligibleSlots).toEqual([]);
        expect(result.unknownRequestedFields).toContain('material');
    });

    test('image currency descriptions and CSV suggested answers never become evidence', () => {
        const result = evaluate('What is the price of Olive Cargo Pant?', createV12Catalog(), {
            inputType: 'Image+Text', simulatedAttachment: '[Image 1: USD 5]', expectedTruth: 'BDT 500',
        });
        expect(result).toMatchObject({
            eligibility: 'ANSWERABLE', productId: 'v12-a-cargo',
            eligibleSlots: [expect.objectContaining({ field: 'price', expectedValue: 1450, currency: 'BDT' })],
        });
        expect(JSON.stringify(result)).not.toMatch(/USD|500/);
        expect(JSON.stringify(createV12Catalog())).not.toMatch(/expectedTruth|oracle|scenario|answerable|USD/);
    });

    test('inactive products and inactive SKU options do not establish facts', () => {
        expect(evaluate('What is the price of Synthetic Coat?', [simple({ is_active: false })]).eligibleSlots).toEqual([]);
        const variants = [{ id: 'inactive', size: 'XXL', color: 'Red', price: 1200, quantity: 2, is_active: false }];
        expect(evaluate('What is the price of Synthetic Coat size XXL color Red?', [simple({ variants })]).eligibleSlots).toEqual([]);
    });

    test('does not treat an unsupported pocket-count question as an identity request', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-a-cargo');
        const result = classifyOracleTurn({
            message: `How many pockets does the ${product.name} have?`, inputType: 'Text',
        }, product.shop_id, catalog);

        expect(result).toMatchObject({
            domain: 'unknown_product_attribute',
            eligibility: 'NOT_ANSWERABLE',
            productId: product.id,
            eligibleSlots: [],
            unknownRequestedFields: ['pocket_count'],
        });
    });

    test('resolves W32 follow-up to the previous exact product and variant', () => {
        const cargo = simple({
            id: 'cargo-1', name: 'Olive Cargo Pant', aliases: ['cargo trousers'],
            variants: [{ id: 'cargo-32-olive', size: '32', color: 'olive', price: 1550, quantity: 2, is_active: true }],
        });
        const result = classifyOracleTurn({ message: 'W32 hobe?', inputType: 'Text' }, 'fixture-shop-a', [cargo], cargo.id);

        expect(result).toMatchObject({
            domain: 'product', eligibility: 'ANSWERABLE', productId: cargo.id,
            selectedVariantId: 'cargo-32-olive',
            eligibleSlots: [expect.objectContaining({ field: 'variant', expectedValue: '32' })],
        });
    });

    test('resolves a Bengali catalog name with a greeting and merchant honorifics', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-a-panjabi');
        const result = classifyOracleTurn({
            message: 'আসসালামু আলাইকুম। কালো পাঞ্জাবি আছে আপনাদের?', inputType: 'Text',
        }, product.shop_id, catalog);

        expect(result).toMatchObject({
            domain: 'product', eligibility: 'ANSWERABLE', productId: product.id,
            eligibleSlots: [expect.objectContaining({ field: 'stock', expectedValue: 'IN_STOCK' })],
        });
    });

    test.each([
        ['accessory compatibility', 'Bhai apnader showroom e ki Panjabi er shathe matching orna ba koti ache?', 'accessory_compatibility'],
        ['surface finish', 'Panjabi er fabric ki shiny naki matte finish?', 'surface_finish'],
    ])('does not treat unsupported %s as a catalog identity or material fact', (_label, message, field) => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-b-panjabi');
        const result = classifyOracleTurn({ message, inputType: 'Text' }, product.shop_id, catalog);

        expect(result).toMatchObject({ eligibility: 'NOT_ANSWERABLE', eligibleSlots: [] });
        expect(result.unknownRequestedFields).toContain(field);
        expect(result.eligibleSlots.some(slot => slot.field === 'identity' || slot.field === 'material')).toBe(false);
    });

    test.each([
        ['Bengali personal size', 'আমার গায়ের সাইজ ৪৪। ৪৪ সাইজ হবে?', 'v12-a-panjabi'],
        ['English chest measurement', 'Chest size 38 er jonno kon size? M naki L?', 'v12-b-panjabi'],
    ])('does not infer garment fit from a %s', (_label, message, productId) => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === productId);
        const result = classifyOracleTurn({ message, inputType: 'Text' }, product.shop_id, catalog, product.id);

        expect(result).toMatchObject({ eligibility: 'NOT_ANSWERABLE', eligibleSlots: [] });
        expect(result.unknownRequestedFields).toContain('body_size_fit');
    });

    test('a numeric size before a Bengali size label does not fall back to parent stock', () => {
        const catalog = createV12Catalog();
        const product = catalog.find(item => item.id === 'v12-a-kamiz');
        const result = classifyOracleTurn({
            message: 'অন্য কোনো ৪৬ সাইজের কামিজ আছে আপনাদের কাছে?', inputType: 'Text',
        }, product.shop_id, catalog);

        expect(result).toMatchObject({
            eligibility: 'NOT_ANSWERABLE',
            variantResolution: 'NOT_FOUND',
            eligibleSlots: [],
        });
    });

    test.each([
        ['a bundled discount', 'Panjabi ar jacket eksathe nile 200 taka discount diben?'],
        ['a fixed-price negotiation', '1450 taka ki fixed price?'],
        ['parcel travel duration', 'Bogra te parcel jete koto din lage?'],
    ])('classifies %s as a merchant-policy question', (_label, message) => {
        const result = classifyOracleTurn({ message, inputType: 'Text' }, 'fixture-shop-b', createV12Catalog(), 'v12-b-panjabi');

        expect(result).toMatchObject({
            domain: 'merchant_policy',
            eligibility: 'NOT_ANSWERABLE',
            eligibleSlots: [],
        });
    });

    test('scores a verified catalog fact while classifying a separate merchant-policy handoff', () => {
        const result = evaluate('What is the price and delivery fee for Synthetic Coat?');
        expect(result.domain).toBe('multi_domain');
        expect(result.domains).toEqual(expect.arrayContaining(['product_price', 'merchant_policy']));
        expect(result.crossDomainHandoffs).toEqual(['merchant_policy']);
        expect(result.eligibleSlots).toEqual([expect.objectContaining({ field: 'price', expectedValue: 1200 })]);
    });

    test('variant prices inherit the parent price when the live variant price is null', () => {
        const coat = simple({
            variants: [{ id: 'coat-m', size: 'M', price: null, quantity: 2, is_active: true }],
        });
        const result = evaluate('What is the price of Synthetic Coat size M?', [coat]);

        expect(result.selectedVariantId).toBe('coat-m');
        expect(result.eligibleSlots).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'price', expectedValue: 1200 }),
            expect.objectContaining({ field: 'variant', expectedValue: 'M' }),
        ]));
    });
});
