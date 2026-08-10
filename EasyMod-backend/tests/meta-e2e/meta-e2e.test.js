'use strict';

/**
 * META-E2E — the production-shaped pipeline, asserted at the Meta boundary.
 *
 *   LLM output is a candidate response, not an authoritative response.
 *   — docs/ai-cost/AI_TRUST_BOUNDARY.md
 *
 * Every scenario enters through the real signed webhook route and asserts on
 * (a) what the Graph Send API would actually have received and (b) the grounding
 * decision EasyModerator recorded for that reply. Nothing between those two
 * points is mocked; see tests/meta-e2e/transport.js for the two stubs and
 * tests/meta-e2e/README.md for where automated transport ends.
 */

const harness = require('./harness');
const transport = require('./transport');
const fixtures = require('./fixtures');
const grounding = require('../../src/modules/ai/grounding');
const productSearch = require('../../src/modules/product/product-search.service');

const { IDS, RUNTIME, EXPECTED, CUSTOMER_PSID } = fixtures;
const { GroundingDecision, ReasonCode, ProductEvidenceStatus, MediaStatus } = grounding;

const LANGUAGES = ['bn', 'en', 'mixed'];

/** Is this text one of EasyModerator's own written replies, in any language? */
const isWrittenReply = (text, builder) =>
    LANGUAGES.some((lang) => text.includes(builder(lang)));

/** Everything a customer would have received across the captured sends. */
const body = (result) => harness.sentBody(result.sends);

jest.setTimeout(120000);

beforeAll(async () => {
    await harness.setupSuite();
});

beforeEach(async () => {
    await harness.resetRun();
});

afterAll(async () => {
    await harness.teardownSuite();
});

// ─────────────────────────────────────────────────────────────────────────────
// Transport preconditions — if these fail, nothing below means anything.
// ─────────────────────────────────────────────────────────────────────────────

describe('the webhook boundary itself', () => {
    test('an unsigned payload is rejected before any pipeline work', async () => {
        const payload = harness.messagePayload({
            pageId: IDS.pageA, psid: CUSTOMER_PSID, text: 'black panjabi ache?',
        });

        const response = await harness.postWebhook(payload, { signature: 'sha256=deadbeef' });

        expect(response.status).toBe(403);
        // Give the dispatcher the same grace the signed case gets, so "nothing
        // was enqueued" cannot pass merely by being checked too early.
        expect(await harness.waitForJobs(1, { timeoutMs: 1000 })).toHaveLength(0);
        expect(transport.capturedSends()).toHaveLength(0);
    });

    test('a signed payload enqueues a real BullMQ job carrying the routed channel', async () => {
        transport.setCandidate('EM E2E Black Panjabi — ৳1847.');
        const payload = harness.messagePayload({
            pageId: IDS.pageA, psid: CUSTOMER_PSID, text: 'black panjabi ache?',
        });

        const response = await harness.postWebhook(payload);
        // Meta is acknowledged before the job is dispatched, on purpose: the ack
        // must not wait on Redis. The job lands a tick later.
        const jobs = await harness.waitForJobs(1);

        expect(response.status).toBe(200);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].data).toMatchObject({
            shopId: IDS.shopA,
            metaChannelId: IDS.channelA,
            platform: 'facebook',
            recipientId: CUSTOMER_PSID,
        });

        // And the worker really consumes it.
        const [result] = await harness.drainQueue();
        expect(result.sent).toBe(true);
    });

    test('a redelivered message id is deduplicated, not answered twice', async () => {
        const mid = 'm_e2e_redelivery_fixed';
        const first = await harness.deliver({
            text: 'black panjabi ache?', mid,
            candidate: 'EM E2E Black Panjabi — ৳1847.',
        });
        const second = await harness.deliver({ text: 'black panjabi ache?', mid });

        expect(first.sends.length).toBeGreaterThan(0);
        expect(second.sends).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-001 — nonexistent product
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-001 — a product this catalog does not contain', () => {
    test('"chiffon saree ache?" is answered from the catalog, with no model call', async () => {
        const result = await harness.deliver({
            text: EXPECTED.nonexistentProductQuery,
            // Scripted hallucination. It must never be reachable: a NOT_FOUND
            // product question is answered deterministically, with zero tokens.
            candidate: 'Ji, chiffon saree ache! Dam 2200 taka, soft chiffon fabric.',
        });

        expect(result.status).toBe(200);

        // The model was never consulted (AI_TRUST_BOUNDARY §12).
        expect(transport.llmProvidersCalled()).toEqual([]);

        const decision = result.decision;
        expect(decision.productStatus).toBe(ProductEvidenceStatus.NOT_FOUND);
        expect(decision.verifiedProductIds).toEqual([]);
        expect(decision.mediaProductId).toBeNull();
        expect(decision.decision).toBe(GroundingDecision.SEND); // written copy, sent as-is
        expect(decision.violations).toEqual([]);

        const sent = body(result);
        expect(isWrittenReply(sent, grounding.productNotFoundReply)).toBe(true);
        expect(sent).not.toContain('2200');
        expect(sent).not.toMatch(/chiffon saree/i);
        expect(harness.sentAttachments(result.sends)).toEqual([]);

        // Alternatives offered are real rows of this shop, nothing else.
        for (const line of sent.split('\n').filter((l) => l.trim().startsWith('•'))) {
            expect(line).toMatch(/EM E2E (Cotton Saree|Chiffon Kurti)/);
        }
    });

    test('the stored reply carries the grounding stamps that explain it', async () => {
        await harness.deliver({
            text: EXPECTED.nonexistentProductQuery,
            candidate: 'Ji, chiffon saree ache!',
        });

        const stored = await harness.lastStoredAiMessage(IDS.shopA);
        expect(stored.metadata.grounding_decision).toBe(GroundingDecision.SEND);
        expect(stored.metadata.grounding_reason).toBe(ReasonCode.GROUNDED);
        expect(stored.metadata.grounding_product_status).toBe(ProductEvidenceStatus.NOT_FOUND);
        // The rest of the evidence is on the row too, so an incident review — or
        // the live Meta certification — never has to scrape a rotating log.
        expect(stored.metadata.grounding_verified_product_ids).toEqual([]);
        expect(stored.metadata.grounding_media_product_id).toBeNull();
        expect(stored.metadata.grounding_attachment_urls).toEqual([]);
        // No provider: this answer was written from the catalog, not by a model.
        expect(stored.metadata.grounding_provider).toBeNull();
        expect(Array.isArray(stored.metadata.grounding_violations)).toBe(true);
        // source_references may only ever contain real catalog rows.
        for (const ref of stored.source_references || []) {
            if (ref.kind === 'product') {
                expect([IDS.relatedProduct, IDS.unknownMaterialProduct]).toContain(ref.id);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-002 — repeated pressure
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-002 — the same conversation under repeated pressure', () => {
    test('four escalating turns never produce a product, a price, a photo or a Page link', async () => {
        const first = await harness.deliver({
            text: EXPECTED.nonexistentProductQuery,
            candidate: 'Ji, chiffon saree ache — 2200 taka.',
        });
        expect(first.decision.productStatus).toBe(ProductEvidenceStatus.NOT_FOUND);

        // Each follow-up scripts the model doing exactly what it did in the
        // production incident: assert it exists, quote a price, offer the Page.
        const pressure = [
            { text: 'picture den', candidate: 'Ei nin chobi: https://facebook.com/EasyModeratorE2E' },
            { text: 'try koren', candidate: 'Try korlam — ji chiffon saree ta ache, 2200 taka.' },
            { text: 'abar check koren', candidate: `Check korlam, ache. Chobi: ${EXPECTED.relatedProductImage}` },
            { text: 'are you sure?', candidate: 'Ji sure — 2200 takay chiffon saree ta pathiye dicchi.' },
        ];

        for (const turn of pressure) {
            const result = await harness.deliver(turn);
            const sent = body(result);

            expect(result.decision.verifiedProductIds).toEqual([]);
            expect(result.decision.productStatus).not.toBe(ProductEvidenceStatus.VERIFIED);
            expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);

            expect(sent).not.toContain('2200');
            expect(sent).not.toContain('facebook.com');
            expect(sent).not.toContain(EXPECTED.relatedProductImage);
            expect(harness.sentAttachments(result.sends)).toEqual([]);
        }

        // Nothing the assistant said along the way was ever recorded as evidence.
        const conversation = await harness.conversationFor(IDS.shopA);
        const stored = await harness.messagesFor(conversation.id);
        for (const message of stored.filter((m) => m.sender === 'ai')) {
            expect(message.metadata.grounding_product_status)
                .not.toBe(ProductEvidenceStatus.VERIFIED);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-003 — known product
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-003 — a product this shop really sells', () => {
    test('the verified price, attribute and photo all reach Meta', async () => {
        const result = await harness.deliver({
            text: 'black panjabi picture den',
            candidate: `${EXPECTED.knownProductName} — ৳${EXPECTED.knownProductPrice}, `
                + `${EXPECTED.knownProductMaterial}. Ei nin chobi ta 😊`,
        });

        const decision = result.decision;
        expect(decision.decision).toBe(GroundingDecision.SEND);
        expect(decision.reasonCode).toBe(ReasonCode.GROUNDED);
        expect(decision.productStatus).toBe(ProductEvidenceStatus.VERIFIED);
        expect(decision.verifiedProductIds).toEqual([IDS.knownProduct]);
        expect(decision.mediaStatus).toBe(MediaStatus.AVAILABLE);
        expect(decision.mediaProductId).toBe(IDS.knownProduct);
        expect(decision.violations).toEqual([]);
        expect(decision.provider).toBe('gemini-lite');

        const sent = body(result);
        expect(sent).toContain(String(EXPECTED.knownProductPrice));
        expect(sent).toContain(EXPECTED.knownProductMaterial);

        // Exactly one attachment, and it is this product's own stored image.
        const attachments = harness.sentAttachments(result.sends);
        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('image');
        expect(attachments[0].payload.url).toBe(EXPECTED.knownProductImage);

        const stored = await harness.lastStoredAiMessage(IDS.shopA);
        expect(stored.metadata.grounding_decision).toBe(GroundingDecision.SEND);
        expect(stored.metadata.grounding_product_status).toBe(ProductEvidenceStatus.VERIFIED);
        // The row records which product owned the media and what URL went out —
        // the two facts an attachment-provenance dispute turns on.
        expect(stored.metadata.grounding_verified_product_ids).toEqual([IDS.knownProduct]);
        expect(stored.metadata.grounding_media_status).toBe(MediaStatus.AVAILABLE);
        expect(stored.metadata.grounding_media_product_id).toBe(IDS.knownProduct);
        expect(stored.metadata.grounding_attachment_urls).toEqual([EXPECTED.knownProductImage]);
        // Meta's own mid, so a delivered reply can be traced back from a support
        // thread without guessing which row it was.
        expect(stored.metadata.delivered).toBe(true);
        expect(stored.metadata.provider_message_id).toMatch(/^mid\./);
        expect(stored.source_references).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'product', id: IDS.knownProduct })]),
        );
    });

    test('a price the catalog does not hold is replaced even for a verified product', async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: `${EXPECTED.knownProductName} — ৳999 only!`,
        });

        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(result.decision.reasonCode).toBe(ReasonCode.UNSUPPORTED_PRICE_CLAIM);
        expect(result.decision.violations).toEqual(
            expect.arrayContaining([expect.stringContaining('unsupported_price:999')]),
        );
        expect(body(result)).not.toContain('999');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-004 — known product, unknown attribute
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-004 — an attribute the catalog does not record', () => {
    test('a fabric asserted for a product with material = NULL is withdrawn', async () => {
        const result = await harness.deliver({
            text: 'chiffon kurti ache?',
            candidate: `Ji, ${EXPECTED.unknownMaterialProductName} ache — `
                + `৳${EXPECTED.unknownMaterialProductPrice}. Eta pure chiffon fabric.`,
        });

        const decision = result.decision;
        expect(decision.productStatus).toBe(ProductEvidenceStatus.VERIFIED);
        expect(decision.verifiedProductIds).toEqual([IDS.unknownMaterialProduct]);
        expect(decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(decision.reasonCode).toBe(ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
        expect(decision.violations).toEqual(
            expect.arrayContaining([expect.stringContaining('attribute_asserted_but_unknown:material')]),
        );

        const sent = body(result);
        // The product and its real price survive — a guardrail must not make the
        // assistant useless — but the fabric claim does not.
        expect(sent).toContain(String(EXPECTED.unknownMaterialProductPrice));
        expect(sent).not.toMatch(/pure chiffon fabric/i);
        expect(sent).toMatch(/nei|not (recorded|available)|নেই/i);
    });

    test('"eta chiffon?" with nothing grounded is answered by asking which product', async () => {
        // The documented follow-up path (AI_TRUST_BOUNDARY §4). Whatever the
        // conversation history says, the fabric is never invented.
        await harness.deliver({
            text: 'blue shirt ache?',
            candidate: `${EXPECTED.unknownAttributeProductName} — ৳${EXPECTED.unknownAttributeProductPrice}.`,
        });

        const result = await harness.deliver({
            text: 'eta chiffon?',
            candidate: 'Ji, eta chiffon.',
        });

        const sent = body(result);
        expect(sent).not.toMatch(/ji,? eta chiffon/i);
        expect(harness.sentAttachments(result.sends)).toEqual([]);
        expect(result.decision.verifiedProductIds).not.toContain(IDS.unknownAttributeProduct);
        // Observed behaviour: message-worker's history loader does not carry
        // source_references, so the contextual-attribute lookup finds nothing and
        // the honest "which product do you mean?" reply is sent. Recorded here so
        // a change in that behaviour is a deliberate decision, not a drift.
        expect(isWrittenReply(sent, grounding.whichProductReply)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-005 — known product without an image
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-005 — a verified product with no stored photo', () => {
    test('the reply says the photo is unavailable and attaches nothing', async () => {
        const result = await harness.deliver({
            text: 'green kurti picture den',
            candidate: `${EXPECTED.noImageProductName} — ৳${EXPECTED.noImageProductPrice}. `
                + 'Ei product er chobi ekhon amader kache nei.',
        });

        expect(result.decision.productStatus).toBe(ProductEvidenceStatus.VERIFIED);
        expect(result.decision.verifiedProductIds).toEqual([IDS.noImageProduct]);
        expect(result.decision.mediaStatus).toBe(MediaStatus.UNAVAILABLE);
        expect(result.decision.mediaProductId).toBeNull();
        expect(harness.sentAttachments(result.sends)).toEqual([]);
        expect(body(result)).toContain(String(EXPECTED.noImageProductPrice));
    });

    test('no substitute media is allowed to stand in for the missing photo', async () => {
        const result = await harness.deliver({
            text: 'green kurti picture den',
            candidate: `Chobi ei link e dekhun: ${EXPECTED.knownProductImage}`,
        });

        const sent = body(result);
        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(sent).not.toContain(EXPECTED.knownProductImage);
        expect(sent).not.toContain('http');
        expect(harness.sentAttachments(result.sends)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-006 — cross-shop isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-006 — a Page that does not own the product', () => {
    test("Shop A's product is NOT_FOUND when asked through Shop B's Page", async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            pageId: IDS.pageB,
            candidate: `Ji, ${EXPECTED.knownProductName} ache — ৳${EXPECTED.knownProductPrice}.`,
        });

        expect(result.decision.productStatus).toBe(ProductEvidenceStatus.NOT_FOUND);
        expect(result.decision.verifiedProductIds).toEqual([]);

        const sent = body(result);
        expect(sent).not.toContain(EXPECTED.knownProductName);
        expect(sent).not.toContain(String(EXPECTED.knownProductPrice));
        expect(sent).not.toContain(EXPECTED.knownProductImage);
        expect(harness.sentAttachments(result.sends)).toEqual([]);

        // The conversation, the customer and the reply all belong to Shop B.
        const conversationB = await harness.conversationFor(IDS.shopB);
        expect(conversationB).not.toBeNull();
        expect(await harness.conversationFor(IDS.shopA)).toBeNull();
    });

    test("Shop B still answers from its own catalog", async () => {
        const result = await harness.deliver({
            text: 'tote bag ache?',
            pageId: IDS.pageB,
            candidate: `${EXPECTED.shopBProductName} — ৳750.`,
        });

        expect(result.decision.productStatus).toBe(ProductEvidenceStatus.VERIFIED);
        expect(result.decision.verifiedProductIds).toEqual([IDS.shopBProduct]);
        expect(body(result)).toContain(EXPECTED.shopBProductName);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-007 — conversation contamination
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-007 — an earlier ungrounded assistant turn', () => {
    test('authoritative retrieval overrides what the assistant said before', async () => {
        await harness.deliver({
            text: EXPECTED.nonexistentProductQuery,
            candidate: 'unused — this turn is answered deterministically',
        });

        const conversation = await harness.conversationFor(IDS.shopA);
        // Reproduce the historical defect: a prior assistant turn asserting a
        // product that does not exist, complete with an invented price.
        await harness.injectAssistantMessage(
            conversation.id,
            'Ji, amader chiffon saree ache — ৳2200, stock ache.',
        );

        const followUp = await harness.deliver({
            text: 'chiffon saree ta ache?',
            candidate: 'Ha, ager je chiffon saree ta bollam — ৳2200 e ache.',
        });

        expect(followUp.decision.productStatus).toBe(ProductEvidenceStatus.NOT_FOUND);
        expect(followUp.decision.verifiedProductIds).toEqual([]);
        expect(body(followUp)).not.toContain('2200');
    });

    test('the model leaning on its own earlier claim is stopped at the gate', async () => {
        const conversation = await harness.deliver({
            text: EXPECTED.nonexistentProductQuery, candidate: 'x',
        }).then(() => harness.conversationFor(IDS.shopA));

        await harness.injectAssistantMessage(
            conversation.id,
            'Ji, amader chiffon saree ache — ৳2200.',
        );

        const result = await harness.deliver({
            text: 'are you sure?',
            candidate: 'Ji sure, ager bola moto ৳2200 e chiffon saree ta ache.',
        });

        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(result.decision.violations).toEqual(
            expect.arrayContaining([expect.stringContaining('unsupported_price:2200')]),
        );
        expect(body(result)).not.toContain('2200');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-008 — merchant knowledge
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-008 — merchant policy the shop never supplied', () => {
    test('an invented return fee never reaches Meta', async () => {
        const result = await harness.deliver({
            text: EXPECTED.unknownPolicyQuery,
            candidate: 'Amader return policy 7 din. Return fee ৳4499 lage.',
        });

        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(result.decision.violations).toEqual(
            expect.arrayContaining([expect.stringContaining('unsupported_price:4499')]),
        );
        expect(body(result)).not.toContain('4499');
    });

    test('a figure the merchant DID supply is quotable, and is attributed', async () => {
        const result = await harness.deliver({
            text: EXPECTED.faqQuery,
            candidate: `Dhaka r vitore ${EXPECTED.faqDeliveryInsideDhaka} taka, `
                + `Dhaka r baire ${EXPECTED.faqDeliveryOutsideDhaka} taka.`,
        });

        expect(result.decision.decision).toBe(GroundingDecision.SEND);
        expect(result.decision.knowledgeIds).toContain(RUNTIME.faqDeliveryId);
        expect(body(result)).toContain(String(EXPECTED.faqDeliveryInsideDhaka));
    });

    test('a figure the merchant did NOT supply is rejected on the same knowledge path', async () => {
        const result = await harness.deliver({
            text: EXPECTED.faqQuery,
            candidate: 'Delivery charge 777 taka.',
        });

        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(body(result)).not.toContain('777');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-009 — attachment and URL provenance
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-009 — media provenance', () => {
    test.each([
        ['another product of this shop', () => EXPECTED.relatedProductImage],
        ['a product of another shop', () => EXPECTED.shopBProductImage],
        ['a generic URL', () => 'https://example.com/some-saree.jpg'],
        ['the shop Facebook Page', () => 'https://facebook.com/EasyModeratorE2E'],
    ])('%s is never sent in place of the verified photo', async (_label, url) => {
        const result = await harness.deliver({
            text: 'black panjabi picture den',
            candidate: `${EXPECTED.knownProductName} — ৳${EXPECTED.knownProductPrice}. Chobi: ${url()}`,
        });

        const sent = body(result);
        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(result.decision.reasonCode).toBe(ReasonCode.UNSUPPORTED_URL_CLAIM);
        expect(sent).not.toContain(url());
        // A rejected candidate forfeits its media too.
        expect(harness.sentAttachments(result.sends)).toEqual([]);
    });

    test('only the verified product URL survives attachment provenance', async () => {
        // The proposed-attachment vector, evaluated by the real gate against
        // evidence built by the real service from the real Shop A catalog rows.
        const rows = await productSearch.getProductsByIds([IDS.knownProduct], IDS.shopA);
        const evidence = grounding.resolveProductEvidence({
            shopId: IDS.shopA,
            message: 'black panjabi picture den',
            candidates: rows,
        });
        expect(evidence.mediaStatus).toBe(MediaStatus.AVAILABLE);

        const verdict = grounding.evaluateCandidate({
            candidate: `${EXPECTED.knownProductName} — ৳${EXPECTED.knownProductPrice}.`,
            evidence,
            attachments: [
                { type: 'image', url: EXPECTED.knownProductImage, productId: IDS.knownProduct },
                { type: 'image', url: EXPECTED.knownProductImage, productId: IDS.relatedProduct },
                { type: 'image', url: EXPECTED.relatedProductImage, productId: IDS.relatedProduct },
                { type: 'image', url: EXPECTED.shopBProductImage, productId: IDS.shopBProduct },
                { type: 'image', url: 'https://example.com/anything.jpg' },
            ],
        });

        expect(verdict.attachments).toEqual([
            { type: 'image', url: EXPECTED.knownProductImage, productId: IDS.knownProduct },
        ]);
        expect(verdict.violations).toContain('attachment_provenance_rejected');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-010 — provider fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-010 — the fallback provider', () => {
    test('a primary-provider outage fails over, and the reply still passes the gate', async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: {
                'gemini-lite': new Error('503 Service Unavailable'),
                openai: `${EXPECTED.knownProductName} — ৳${EXPECTED.knownProductPrice}.`,
            },
        });

        expect(transport.llmProvidersCalled()).toEqual(['gemini-lite', 'openai']);
        expect(result.decision.provider).toBe('openai');
        expect(result.decision.decision).toBe(GroundingDecision.SEND);
        expect(body(result)).toContain(String(EXPECTED.knownProductPrice));
    });

    test('the fallback provider is held to exactly the same boundary', async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: {
                'gemini-lite': new Error('503 Service Unavailable'),
                openai: `${EXPECTED.knownProductName} — ৳3333, silk.`,
            },
        });

        expect(result.decision.provider).toBe('openai');
        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);
        expect(body(result)).not.toContain('3333');
    });

    test('every provider failing sends the generic fallback and holds for a human', async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: new Error('503 Service Unavailable'),
        });

        expect(result.jobResults[0].sent).toBe(false);
        expect(result.jobResults[0].reason).toBe('low_confidence_handoff');
        expect(body(result)).not.toContain(String(EXPECTED.knownProductPrice));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-011 — retrieval failure
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-011 — the catalog cannot be read', () => {
    afterEach(() => jest.restoreAllMocks());

    test('an outage becomes RETRIEVAL_FAILED, a human handoff and no answer', async () => {
        jest.spyOn(productSearch, 'searchByAttributes')
            .mockRejectedValue(new Error('E2E: simulated Postgres outage'));

        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: 'Ji ache, ৳1847.',
        });

        expect(result.decision.productStatus).toBe(ProductEvidenceStatus.RETRIEVAL_FAILED);
        expect(result.decision.verifiedProductIds).toEqual([]);
        expect(result.jobResults[0].sent).toBe(false);
        expect(result.jobResults[0].reason).toBe('low_confidence_handoff');
        expect(result.jobResults[0].handoff).toBe(true);

        // The only thing that may go out is EasyModerator's own holding message —
        // never a claim about the product.
        const sent = body(result);
        expect(sent).not.toContain('1847');
        expect(sent).not.toContain(EXPECTED.knownProductName);

        const stored = await harness.lastStoredAiMessage(IDS.shopA);
        expect(stored.metadata.grounding_product_status)
            .toBe(ProductEvidenceStatus.RETRIEVAL_FAILED);
        expect(stored.metadata.delivered).toBe(false);
        expect(stored.metadata.held_reason).toBe('low_confidence');
    });

    test('an outage is never downgraded to "we do not sell that"', async () => {
        jest.spyOn(productSearch, 'searchByAttributes')
            .mockRejectedValue(new Error('E2E: simulated Postgres outage'));

        const result = await harness.deliver({
            text: EXPECTED.nonexistentProductQuery,
            candidate: 'unused',
        });

        expect(result.decision.productStatus).not.toBe(ProductEvidenceStatus.NOT_FOUND);
        expect(body(result)).not.toMatch(/couldn't find|pacchi na|পাচ্ছি না/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// META-E2E-012 — malformed model output
// ─────────────────────────────────────────────────────────────────────────────

describe('META-E2E-012 — unusable model output', () => {
    test('an empty completion for a product question is replaced by written copy', async () => {
        const result = await harness.deliver({
            text: 'black panjabi ache?',
            candidate: '   ',
        });

        expect(result.decision.reasonCode).toBe(ReasonCode.MODEL_OUTPUT_INVALID);
        expect(result.decision.violations).toContain('empty_or_non_string_candidate');
        expect(result.decision.decision).toBe(GroundingDecision.SAFE_FALLBACK);

        const sent = body(result);
        expect(sent.trim().length).toBeGreaterThan(0);
        expect(harness.sentAttachments(result.sends)).toEqual([]);
    });

    test('an empty completion with nothing to answer sends nothing at all', async () => {
        // "ok" carries no product-identifying term at all, so the evidence is
        // NONE: there is no written reply that could be true, and silence plus a
        // human beats a guess.
        const result = await harness.deliver({ text: 'ok', candidate: '' });

        expect(result.decision.decision).toBe(GroundingDecision.SUPPRESS);
        expect(result.decision.reasonCode).toBe(ReasonCode.MODEL_OUTPUT_INVALID);
        expect(result.jobResults[0].reason).toBe('grounding_suppressed');
        expect(result.jobResults[0].handoff).toBe(true);
        expect(harness.sentTexts(result.sends).join('\n')).not.toContain('undefined');
    });
});
