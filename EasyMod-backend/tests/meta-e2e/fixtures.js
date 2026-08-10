'use strict';

/**
 * Deterministic catalog and channel fixtures for the Meta-shaped E2E suite.
 *
 * Fixed UUIDs: the same IDs appear in docs/testing/META_E2E_TEST_SETUP.md and in
 * the live-Meta runner, so a failure message names an asset a human can look up.
 *
 * Two shops exist on purpose. Shop A owns the whole catalog; Shop B owns one
 * unrelated product and its own Page. Cross-shop isolation is only meaningful
 * when the "wrong" shop has a real, non-empty catalog of its own — an empty one
 * would pass the test for the wrong reason.
 */

const { sequelize } = require('../../src/utils/database/database-setup');
const {
    Tenant, Shop, Product, Subscription, FaqResponse,
} = require('../../src/modules/entities');
const MetaChannel = require('../../src/modules/channel-providers/meta-channel.entity');

// ── Identities ───────────────────────────────────────────────────────────────

const IDS = Object.freeze({
    tenant: '11111111-1111-4111-8111-111111111111',

    shopA: 'aaaaaaaa-0000-4000-8000-00000000000a',
    shopB: 'bbbbbbbb-0000-4000-8000-00000000000b',

    channelA: 'aaaaaaaa-1111-4111-8111-11111111111a',
    channelB: 'bbbbbbbb-1111-4111-8111-11111111111b',

    // Meta Page IDs are strings, not UUIDs. These are E2E stand-ins; the live
    // runner uses the real tester Page ID from META_E2E_PAGE_ID.
    pageA: '100000000000001',
    pageB: '100000000000002',

    knownProduct: 'cccccccc-0000-4000-8000-00000000000c',
    unknownAttributeProduct: 'dddddddd-0000-4000-8000-00000000000d',
    noImageProduct: 'eeeeeeee-0000-4000-8000-00000000000e',
    relatedProduct: 'ffffffff-0000-4000-8000-00000000000f',
    unknownMaterialProduct: '77777777-0000-4000-8000-000000000007',
    shopBProduct: '99999999-0000-4000-8000-000000000009',
});

/**
 * IDs that only exist once a run has seeded. `faq_responses.id` is a serial, so
 * it cannot be pinned like the UUID fixtures above.
 */
const RUNTIME = {};

/** The customer PSID the automated suite pretends to be. */
const CUSTOMER_PSID = '7000000000000001';

/** Expected facts, asserted by name so a fixture edit cannot silently pass. */
const EXPECTED = Object.freeze({
    knownProductName: 'EM E2E Black Panjabi',
    knownProductPrice: 1847,
    knownProductMaterial: 'Cotton',
    knownProductImage: 'https://cdn.easymod.tech/e2e/em-e2e-black-panjabi.jpg',

    unknownAttributeProductName: 'EM E2E Blue Shirt',
    unknownAttributeProductPrice: 990,

    noImageProductName: 'EM E2E Green Kurti',
    noImageProductPrice: 1250,

    // A product whose NAME says chiffon while the structured material column is
    // empty. That gap is the §5 case: the name is not a fabric claim, so the
    // reply must admit the material is not recorded rather than assert it.
    unknownMaterialProductName: 'EM E2E Chiffon Kurti',
    unknownMaterialProductPrice: 1390,
    unknownMaterialProductImage: 'https://cdn.easymod.tech/e2e/em-e2e-chiffon-kurti.jpg',

    relatedProductName: 'EM E2E Cotton Saree',
    relatedProductPrice: 2100,
    relatedProductImage: 'https://cdn.easymod.tech/e2e/em-e2e-cotton-saree.jpg',

    shopBProductName: 'EM E2E Tote Bag',
    shopBProductImage: 'https://cdn.easymod.tech/e2e/em-e2e-tote-bag.jpg',

    nonexistentProductQuery: 'chiffon saree ache?',

    // Every token hits the seeded FAQ, so the router's keyword-FAQ tier scores
    // 1.0 and the reply clears the shop's 75% confidence threshold. A partial
    // match (e.g. "delivery charge koto?" → 0.67) is correctly held for a human,
    // which is a different assertion — see the low-confidence coverage below.
    faqQuery: 'delivery charge',
    faqDeliveryInsideDhaka: 60,
    faqDeliveryOutsideDhaka: 120,

    unknownPolicyQuery: 'return policy ki?',
});

/** Test-only Page access token. Stored through the channel's encrypting setter. */
const E2E_PAGE_TOKEN = 'EAAE2E-not-a-real-page-token';

// ── Schema lifecycle ─────────────────────────────────────────────────────────

/**
 * Refuse to run against anything that is not obviously an E2E database.
 *
 * This suite truncates tables. A mistyped DATABASE_URL must abort, not delete a
 * merchant catalog.
 */
const assertDisposableDatabase = () => {
    const url = process.env.DATABASE_URL || '';
    let name = '';
    try { name = new URL(url).pathname.replace(/^\//, ''); } catch { /* handled below */ }
    if (!/e2e|test/i.test(name)) {
        throw new Error(
            `meta-e2e refuses to run against database "${name || url}". `
            + 'DATABASE_URL must name a disposable database containing "e2e" or "test".',
        );
    }
};

/**
 * Build the schema the way production does, in the same order:
 *   1. the migration chain — it owns tables no Sequelize model declares
 *      (order_sessions is the one the AI pipeline touches on every turn), and
 *   2. sequelize.sync() — CREATE TABLE IF NOT EXISTS for the entity graph.
 *
 * Migrations run in a child process because src/database/migrate.js is a CLI
 * that ends in process.exit; they are idempotent, so this is a fast no-op once
 * the E2E database has been built.
 */
const runMigrations = () => {
    const { execFileSync } = require('child_process');
    const path = require('path');
    execFileSync(process.execPath, [path.join(__dirname, '../../src/database/migrate.js'), 'up'], {
        cwd: path.join(__dirname, '../..'),
        env: process.env,
        stdio: 'pipe',
    });
};

const syncSchema = async () => {
    assertDisposableDatabase();
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    runMigrations();
    // Loading the entity graph is what registers every model on the instance.
    require('../../src/modules/entities');
    require('../../src/modules/channel-providers/meta-channel.entity');
    require('../../src/modules/channel-providers/meta-channel-settings.entity');
    require('../../src/modules/channel-providers/meta-channel-consent-event.entity');
    require('../../src/modules/integration/meta-webhook-receipt.entity');
    require('../../src/modules/policy/policy-decision.entity');
    await sequelize.sync();
};

/**
 * Empty every table except the migration ledger, between scenarios.
 *
 * DELETE, not TRUNCATE: TRUNCATE takes an ACCESS EXCLUSIVE lock and rewrites the
 * relation files, which costs ~16s for this schema on a containerised Postgres
 * — per test. DELETE over empty-ish tables is ~80ms.
 *
 * Order comes from retrying rather than from a hand-maintained dependency list:
 * a table that still has children fails its DELETE and is retried on the next
 * pass, so the sweep cannot rot when a migration adds a foreign key.
 */
const truncateAll = async () => {
    assertDisposableDatabase();
    const rows = await sequelize.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'",
        { type: sequelize.QueryTypes.SELECT },
    );

    let pending = rows.map((r) => r.tablename);
    for (let pass = 0; pass < 5 && pending.length; pass += 1) {
        const blocked = [];
        for (const table of pending) {
            // eslint-disable-next-line no-await-in-loop
            await sequelize.query(`DELETE FROM "${table}"`).catch(() => blocked.push(table));
        }
        if (blocked.length === pending.length) break; // no progress — report below
        pending = blocked;
    }
    if (pending.length) {
        throw new Error(`meta-e2e: could not clear ${pending.join(', ')}`);
    }
};

// ── Seeding ──────────────────────────────────────────────────────────────────

const product = (over) => ({
    shop_id: IDS.shopA,
    quantity: 10,
    in_stock: true,
    is_active: true,
    track_quantity: true,
    tags: [],
    images: [],
    variants: [],
    ...over,
    // ai_search_text feeds the Postgres full-text index the catalog search runs
    // against; without it a product is unreachable by free-text query.
    ai_search_text: [over.name, over.category, over.ai_color_primary, over.ai_material]
        .filter(Boolean).join(' '),
});

const seed = async () => {
    await Tenant.create({ id: IDS.tenant, name: 'EM E2E Tenant' });

    for (const [id, name] of [[IDS.shopA, 'EM E2E Shop A'], [IDS.shopB, 'EM E2E Shop B']]) {
        await Shop.create({
            id,
            tenant_id: IDS.tenant,
            unique_code: `EME2E-${id.slice(0, 4).toUpperCase()}`,
            shop_name: name,
            name,
            settings: { ai: { automation_mode: 'AI_ACTIVE', confidence_threshold: 75 } },
        });
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await Subscription.create({
            shop_id: id,
            status: 'active',
            plan_code: 'starter',
            current_period_end: periodEnd,
            next_billing_date: periodEnd,
        });
    }

    // ── Shop A catalog ───────────────────────────────────────────────────────
    await Product.bulkCreate([
        product({
            id: IDS.knownProduct,
            name: EXPECTED.knownProductName,
            category: 'panjabi',
            price: EXPECTED.knownProductPrice,
            image_url: EXPECTED.knownProductImage,
            ai_category: 'panjabi',
            ai_color_primary: 'black',
            ai_material: EXPECTED.knownProductMaterial,
        }),
        product({
            id: IDS.unknownAttributeProduct,
            name: EXPECTED.unknownAttributeProductName,
            category: 'shirt',
            price: EXPECTED.unknownAttributeProductPrice,
            image_url: 'https://cdn.easymod.tech/e2e/em-e2e-blue-shirt.jpg',
            ai_category: 'shirt',
            ai_color_primary: 'blue',
            // Deliberately NULL: the catalog does not record this fabric, so the
            // reply must say so rather than name one.
            ai_material: null,
        }),
        product({
            id: IDS.noImageProduct,
            name: EXPECTED.noImageProductName,
            category: 'kurti',
            price: EXPECTED.noImageProductPrice,
            image_url: null,
            images: [],
            ai_category: 'kurti',
            ai_color_primary: 'green',
            ai_material: 'Cotton',
        }),
        product({
            id: IDS.unknownMaterialProduct,
            name: EXPECTED.unknownMaterialProductName,
            category: 'kurti',
            price: EXPECTED.unknownMaterialProductPrice,
            image_url: EXPECTED.unknownMaterialProductImage,
            ai_category: 'kurti',
            ai_color_primary: 'pink',
            ai_material: null,
        }),
        product({
            id: IDS.relatedProduct,
            name: EXPECTED.relatedProductName,
            category: 'saree',
            price: EXPECTED.relatedProductPrice,
            image_url: EXPECTED.relatedProductImage,
            ai_category: 'saree',
            ai_color_primary: 'white',
            ai_material: 'Cotton',
        }),
        // ── Shop B catalog ───────────────────────────────────────────────────
        product({
            id: IDS.shopBProduct,
            shop_id: IDS.shopB,
            name: EXPECTED.shopBProductName,
            category: 'bag',
            price: 750,
            image_url: EXPECTED.shopBProductImage,
            ai_category: 'bag',
            ai_color_primary: 'brown',
            ai_material: 'Canvas',
        }),
    ]);

    const faq = await FaqResponse.create({
        shop_id: IDS.shopA,
        category: 'delivery charge',
        template_en: `Delivery charge is ${EXPECTED.faqDeliveryInsideDhaka} taka inside Dhaka `
            + `and ${EXPECTED.faqDeliveryOutsideDhaka} taka outside Dhaka.`,
        is_active: true,
        priority: 10,
    });
    RUNTIME.faqDeliveryId = String(faq.id);

    // ── Channels ─────────────────────────────────────────────────────────────
    for (const [id, shopId, pageId, name] of [
        [IDS.channelA, IDS.shopA, IDS.pageA, 'EM E2E Page A'],
        [IDS.channelB, IDS.shopB, IDS.pageB, 'EM E2E Page B'],
    ]) {
        await MetaChannel.create({
            id,
            shop_id: shopId,
            platform: 'facebook',
            meta_asset_id: pageId,
            display_name: name,
            // Assigned through the entity setter, so it lands AES-256-GCM
            // encrypted exactly as a real OAuth connection would.
            page_access_token_ct: E2E_PAGE_TOKEN,
            webhook_subscribed_fields: ['messages'],
            status: 'CONNECTED',
            connected_at: new Date(),
        });
    }
};

module.exports = {
    IDS,
    RUNTIME,
    EXPECTED,
    CUSTOMER_PSID,
    E2E_PAGE_TOKEN,
    syncSchema,
    truncateAll,
    seed,
    assertDisposableDatabase,
};
