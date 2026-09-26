#!/usr/bin/env node
'use strict';

/**
 * Mobile dev seed — Phase 2 Lane 0 (mobile/p2-devenv).
 *
 * WHAT: seeds exactly one demo shop ("EasyMod Mobile Dev Shop") with data covering every
 * tier of the Needs Attention ranking table (MOBILE_PRODUCT_SPEC.md §2.1 / ADR M-008), so the
 * mobile `.dev` build has something real to render against a freshly migrated disposable
 * backend:
 *   - 2 draft orders, different ages/values                        (tier 3)
 *   - 1 conversation needing a reply, 1 handed off to a human (hitl:true) (tier 2)
 *   - 1 courier_dispatch FAILED row, 1 INDETERMINATE row            (tier 1)
 *   - the shop has zero DeliveryIntegration rows, which trips
 *     courier-readiness.service.js's SETUP_INCOMPLETE path, blocking
 *     a third, separately-seeded "ready to ship" order              (tier 1)
 *   - 2 products with track_quantity/is_active true and quantity < low_stock_threshold,
 *     plus 1 untracked/inactive decoy at zero stock (must NOT count, per D1)  (tier 5)
 *   - 1 customer phone RtoShieldService.checkPhone classifies "verify" tier,
 *     tied to one of the draft orders above                         (tier 4)
 *
 * SAFETY: refuses to run unless NODE_ENV/config.env is "development" or "test", and refuses
 * unless DATABASE_URL is a postgres:// URL pointing at localhost/127.0.0.1 — i.e. the
 * disposable Postgres 16 container from docker-compose.test.yml (or an equivalent local
 * instance), never the pilot production database. Performs zero Meta/AI provider calls.
 *
 * IDEMPOTENT: every row's id is a deterministic uuidv5 derived from SEED_KEY, so re-running
 * this script updates the same rows in place instead of duplicating them.
 *
 * REMOVABLE: `node scripts/seed-mobile-dev.js --remove` deletes every row this script owns,
 * in dependency order. Nothing else in the database is touched either way.
 *
 * USAGE (from EasyMod-backend/, against a running disposable Postgres — see
 * docs/mobile/DEV_SETUP.md §3, e.g. `docker compose -f ../docker-compose.test.yml up -d`):
 *   DATABASE_URL=postgres://e2e:e2e@127.0.0.1:55432/easymod_integration_test \
 *     node scripts/seed-mobile-dev.js
 *   ... node scripts/seed-mobile-dev.js --remove       # tear down
 *
 * ENV:
 *   DATABASE_URL               required; must be postgres:// on localhost/127.0.0.1
 *   MOBILE_DEV_SEED_PASSWORD   optional; login password for the seeded owner (default below)
 */

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const { v5: uuidv5 } = require('uuid');
const config = require('../src/config/config');
const entities = require('../src/modules/entities');
const { sequelize } = require('../src/utils/database/database-setup');
const { hashPassword } = require('../src/utils/password.util');
const { normalizePhone } = require('../src/utils/validators/phone.validator');
const RtoBlacklist = require('../src/modules/rto-shield/rto-blacklist.entity');
const courierReadiness = require('../src/modules/delivery/courier-readiness.service');
const RtoShieldService = require('../src/modules/rto-shield/rto-shield.service');

const {
    User, Tenant, Shop, UserShop, Customer, Product, Order,
} = entities;
const CourierDispatch = require('../src/modules/delivery/courier-dispatch.entity');
const { Conversation, Message } = require('../src/modules/conversation/conversation.entity');

const SEED_KEY = 'mobile-dev-seed-v1';
const NAMESPACE = '7a23a79e-c3f2-418a-956e-bb8e7865235b';
const SHOP_CODE = 'MOBILEDEV01';
const SHOP_NAME = 'EasyMod Mobile Dev Shop';
const OWNER_EMAIL = 'mobile-dev@easymod.test';
const OWNER_PASSWORD = process.env.MOBILE_DEV_SEED_PASSWORD || 'MobileDev123!';

// A second, deliberately minimal merchant (own tenant, shop, owner and one low-stock product) so
// device E2E can prove shop isolation: nothing of shop A may appear after signing in as shop B,
// and shop A's entity ids must resolve as "unavailable" for shop B.
const SECOND_SHOP = {
    tenantScope: 'tenant:b',
    shopScope: 'shop:b',
    ownerScope: 'user:owner-b',
    membershipScope: 'user-shop:owner-b',
    productScope: 'product:shop-b-low-stock',
    code: 'MOBILEDEV02',
    name: 'EasyMod Mobile Dev Shop B',
    ownerEmail: 'mobile-dev-b@easymod.test',
};

const stableId = (scope) => uuidv5(`${SEED_KEY}:${scope}`, NAMESPACE);
const hoursAgo = (now, hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);

// ── Safety guards ───────────────────────────────────────────────────────────

function assertNeverProduction() {
    if (config.env === 'production') {
        throw new Error('seed-mobile-dev.js refuses to run when config.env === "production"');
    }
}

function assertDisposablePostgres() {
    const raw = config.databaseUrl;
    if (!raw || typeof raw !== 'string') {
        throw new Error('DATABASE_URL must be set (a disposable Postgres, e.g. docker-compose.test.yml)');
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        throw new Error('DATABASE_URL is not a valid URL');
    }
    if (!/^postgres/i.test(parsed.protocol)) {
        throw new Error('DATABASE_URL must be a postgres:// connection (this seed never targets sqlite)');
    }
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        throw new Error(
            `Refusing to seed a non-local Postgres host ("${parsed.hostname}"). ` +
            'This script only ever targets a disposable local/dev Postgres.',
        );
    }
}

// ── Fixture data ─────────────────────────────────────────────────────────────

function buildFixtures(now) {
    return {
        customers: {
            draftRisky: {
                key: 'customer:draft-risky',
                name: 'Rina Akter (Seed)',
                phone: '01911000001',
                channel_type: 'manual',
            },
            draftLarge: {
                key: 'customer:draft-large',
                name: 'Kamal Hossain (Seed)',
                phone: '01911000002',
                channel_type: 'manual',
            },
            readyToShip: {
                key: 'customer:ready-to-ship',
                name: 'Sultana Yasmin (Seed)',
                phone: '01911000003',
                channel_type: 'manual',
            },
            dispatchFailed: {
                key: 'customer:dispatch-failed',
                name: 'Jahangir Alam (Seed)',
                phone: '01911000004',
                channel_type: 'manual',
            },
            dispatchIndeterminate: {
                key: 'customer:dispatch-indeterminate',
                name: 'Moushumi Begum (Seed)',
                phone: '01911000005',
                channel_type: 'manual',
            },
            needsReply: {
                key: 'customer:needs-reply',
                name: 'Nasrin Sultana (Seed)',
                phone: '01911000006',
                channel_type: 'messenger',
            },
            hitl: {
                key: 'customer:hitl',
                name: 'Tariq Rahman (Seed)',
                phone: '01911000007',
                channel_type: 'instagram',
            },
        },
        // Tier 3 — draft orders awaiting confirmation, different ages/values.
        orders: {
            draftRisky: {
                key: 'order:draft-risky',
                customerKey: 'draftRisky',
                order_status: 'draft',
                payment_status: 'pending',
                total: 450,
                createdHoursAgo: 30,
            },
            draftLarge: {
                key: 'order:draft-large',
                customerKey: 'draftLarge',
                order_status: 'draft',
                payment_status: 'pending',
                total: 3200,
                createdHoursAgo: 3,
            },
            // Tier 1 — confirmed/ready-to-ship, but the shop has no courier
            // integration configured at all (see ensureNoDeliveryIntegration below),
            // so courier-readiness.service.js reports SETUP_INCOMPLETE and this
            // order cannot be dispatched.
            readyToShip: {
                key: 'order:ready-to-ship',
                customerKey: 'readyToShip',
                order_status: 'confirmed',
                payment_status: 'pending',
                total: 1150,
                createdHoursAgo: 20,
            },
            // Tier 1 — courier_dispatch.status = 'FAILED' (source of truth per D2).
            dispatchFailed: {
                key: 'order:dispatch-failed',
                customerKey: 'dispatchFailed',
                order_status: 'confirmed',
                payment_status: 'pending',
                total: 890,
                createdHoursAgo: 6,
            },
            // Tier 1 — courier_dispatch.status = 'INDETERMINATE'.
            dispatchIndeterminate: {
                key: 'order:dispatch-indeterminate',
                customerKey: 'dispatchIndeterminate',
                order_status: 'confirmed',
                payment_status: 'pending',
                total: 1620,
                createdHoursAgo: 8,
            },
        },
        courierDispatches: {
            dispatchFailed: {
                key: 'dispatch:failed',
                orderKey: 'dispatchFailed',
                provider: 'steadfast',
                status: 'FAILED',
                error: 'Seed fixture: simulated provider rejection (no real courier call made).',
                createdHoursAgo: 5,
            },
            dispatchIndeterminate: {
                key: 'dispatch:indeterminate',
                orderKey: 'dispatchIndeterminate',
                provider: 'pathao',
                status: 'INDETERMINATE',
                error: 'Seed fixture: simulated ambiguous provider response (no real courier call made).',
                createdHoursAgo: 8,
            },
        },
        // Tier 2 — Inbox conversations. Each has exactly one, unanswered customer
        // message so deriveWorkflowProjection() marks it needs_merchant_reply:true
        // (conversation.service.js — unanswered && no active provider attempt).
        conversations: {
            needsReply: {
                key: 'conversation:needs-reply',
                customerKey: 'needsReply',
                channel: 'messenger',
                status: 'active',
                hitl: false,
                message: 'আমার অর্ডার কবে পাবো? ৩ দিন হয়ে গেছে।',
                createdHoursAgo: 2,
            },
            hitl: {
                key: 'conversation:hitl',
                customerKey: 'hitl',
                channel: 'instagram',
                status: 'active',
                hitl: true,
                message: 'This is unacceptable, I want a refund right now.',
                createdHoursAgo: 1,
            },
        },
        // Tier 5 — low stock. Two real signals (tracked + active + below threshold)
        // and one decoy that must NOT count per D1 (untracked, inactive, zero stock).
        products: {
            lowStockA: {
                key: 'product:low-stock-a',
                name: 'Premium Panjabi - Navy (Seed)',
                price: 1490,
                quantity: 2,
                low_stock_threshold: 5,
                track_quantity: true,
                is_active: true,
            },
            lowStockB: {
                key: 'product:low-stock-b',
                name: 'Cotton Saree - Maroon (Seed)',
                price: 2200,
                quantity: 1,
                low_stock_threshold: 10,
                track_quantity: true,
                is_active: true,
            },
            decoyUntracked: {
                key: 'product:decoy-untracked',
                name: 'Untracked Decoy Item (Seed)',
                price: 500,
                quantity: 0,
                low_stock_threshold: 5,
                track_quantity: false,
                is_active: false,
            },
        },
        // Tier 4 — RTO-risk customer awaiting verification, tied to a pending
        // order (draftRisky above). risk_score 55 lands in RtoShieldService's
        // VERIFY band (50-69; classifyTier in rto-shield.service.js).
        rtoBlacklistEntry: {
            customerKey: 'draftRisky',
            risk_score: 55,
            reason: 'Seed fixture: elevated return history (RtoShieldService verify-tier demo).',
        },
    };
}

// ── Ensure helpers (idempotent: deterministic id, find-then-update-or-create) ──

async function ensureTenant(transaction) {
    const id = stableId('tenant');
    const defaults = {
        id,
        name: 'EasyMod Mobile Dev Tenant',
        is_active: true,
        settings: { mobile_dev_seed: SEED_KEY },
    };
    const [tenant] = await Tenant.findOrCreate({ where: { id }, defaults, transaction });
    if (tenant.name !== defaults.name) await tenant.update({ name: defaults.name }, { transaction });
    return tenant;
}

async function ensureShop(tenant, transaction) {
    const id = stableId('shop');
    const defaults = {
        id,
        unique_code: SHOP_CODE,
        tenant_id: tenant.id,
        shop_name: SHOP_NAME,
        name: SHOP_NAME,
        is_active: true,
        timezone: 'Asia/Dhaka',
        settings: { mobile_dev_seed: SEED_KEY },
    };
    let shop = await Shop.findOne({ where: { id }, transaction });
    if (!shop) {
        shop = await Shop.create(defaults, { transaction });
    } else {
        await shop.update({
            unique_code: SHOP_CODE,
            shop_name: SHOP_NAME,
            name: SHOP_NAME,
            is_active: true,
            timezone: 'Asia/Dhaka',
        }, { transaction });
    }
    return shop;
}

async function ensureOwnerUser(transaction) {
    const id = stableId('user:owner');
    const hashedPassword = await hashPassword(OWNER_PASSWORD);
    let user = await User.findOne({ where: { id }, transaction });
    if (!user) {
        user = await User.create({
            id,
            email: OWNER_EMAIL,
            password: hashedPassword,
            full_name: 'Mobile Dev Owner (Seed)',
            token_version: 1,
        }, { transaction });
    } else {
        await user.update({ email: OWNER_EMAIL, password: hashedPassword, full_name: 'Mobile Dev Owner (Seed)' }, { transaction });
    }
    return user;
}

async function ensureOwnerMembership(user, shop, transaction) {
    const id = stableId('user-shop:owner');
    const [membership] = await UserShop.findOrCreate({
        where: { id },
        defaults: {
            id, user_id: user.id, shop_id: shop.id, role: 'owner', is_active: true,
        },
        transaction,
    });
    if (membership.role !== 'owner' || !membership.is_active) {
        await membership.update({ role: 'owner', is_active: true }, { transaction });
    }
    if (user.last_logged_shop_id !== shop.id) {
        await user.update({ last_logged_shop_id: shop.id }, { transaction });
    }
    return membership;
}

async function ensureCustomer(shop, fixture, transaction) {
    const id = stableId(fixture.key);
    const phone = normalizePhone(fixture.phone);
    const defaults = {
        id,
        shop_id: shop.id,
        name: fixture.name,
        channel_type: fixture.channel_type,
        channel_user_id: `seed-${fixture.key}`,
        phone,
        last_active: new Date(),
        metadata: { mobile_dev_seed: SEED_KEY },
    };
    let customer = await Customer.findOne({ where: { id }, transaction });
    if (!customer) {
        customer = await Customer.create(defaults, { transaction });
    } else {
        await customer.update({ name: fixture.name, phone }, { transaction });
    }
    return customer;
}

async function ensureProduct(shop, fixture, transaction) {
    const id = stableId(fixture.key);
    const defaults = {
        id,
        shop_id: shop.id,
        name: fixture.name,
        price: fixture.price,
        quantity: fixture.quantity,
        low_stock_threshold: fixture.low_stock_threshold,
        track_quantity: fixture.track_quantity,
        is_active: fixture.is_active,
        category: 'Seed Demo',
    };
    let product = await Product.findOne({ where: { id }, paranoid: false, transaction });
    if (!product) {
        product = await Product.create(defaults, { transaction });
    } else {
        if (product.deletedAt && typeof product.restore === 'function') await product.restore({ transaction });
        await product.update({
            quantity: fixture.quantity,
            low_stock_threshold: fixture.low_stock_threshold,
            track_quantity: fixture.track_quantity,
            is_active: fixture.is_active,
        }, { transaction });
    }
    return product;
}

async function ensureOrder(shop, fixture, customer, now, transaction) {
    const id = stableId(fixture.key);
    const createdAt = hoursAgo(now, fixture.createdHoursAgo);
    const defaults = {
        id,
        shop_id: shop.id,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        order_number: `SEED-${fixture.key.toUpperCase()}`,
        channel: 'manual',
        order_status: fixture.order_status,
        payment_status: fixture.payment_status,
        total: fixture.total,
        subtotal: fixture.total,
        metadata: { mobile_dev_seed: SEED_KEY },
        // Order does not remap Sequelize's managed timestamp attributes (unlike
        // Message/CourierDispatch below), so the JS-side keys stay camelCase
        // even though the columns are snake_case (`underscored: true` only
        // renames the column, not the attribute) — `created_at`/`updated_at`
        // here would be silently ignored and every row would get "now".
        createdAt,
        updatedAt: createdAt,
    };
    let order = await Order.findOne({ where: { id }, transaction });
    if (!order) {
        order = await Order.create(defaults, { transaction, silent: true });
    } else {
        await order.update({
            order_status: fixture.order_status,
            payment_status: fixture.payment_status,
            total: fixture.total,
            subtotal: fixture.total,
        }, { transaction, silent: true });
        // created_at is intentionally not touched on re-run so "age" stays stable
        // across repeated seed invocations within the same day.
    }
    return order;
}

async function ensureCourierDispatch(shop, fixture, order, now, transaction) {
    const id = stableId(fixture.key);
    const createdAt = hoursAgo(now, fixture.createdHoursAgo);
    const defaults = {
        id,
        shop_id: shop.id,
        order_id: order.id,
        provider: fixture.provider,
        idempotency_key: `seed-${fixture.key}`,
        status: fixture.status,
        error: fixture.error,
        created_at: createdAt,
        updated_at: createdAt,
    };
    let dispatch = await CourierDispatch.findOne({ where: { id }, transaction });
    if (!dispatch) {
        dispatch = await CourierDispatch.create(defaults, { transaction, silent: true });
    } else {
        await dispatch.update({ status: fixture.status, error: fixture.error }, { transaction, silent: true });
    }
    return dispatch;
}

async function ensureConversationWithMessage(shop, fixture, customer, now, transaction) {
    const id = stableId(fixture.key);
    const createdAt = hoursAgo(now, fixture.createdHoursAgo);
    const defaults = {
        id,
        shop_id: shop.id,
        customer_id: customer.id,
        channel: fixture.channel,
        title: `[SEED] ${fixture.message.slice(0, 40)}`,
        status: fixture.status,
        role: 'user',
        message: fixture.message,
        hitl: fixture.hitl,
        metadata: { mobile_dev_seed: SEED_KEY },
        // Same camelCase note as ensureOrder() above: Conversation does not
        // remap its managed timestamp attribute names.
        createdAt,
        updatedAt: createdAt,
    };
    let conversation = await Conversation.findOne({ where: { id }, transaction });
    if (!conversation) {
        conversation = await Conversation.create(defaults, { transaction, silent: true });
    } else {
        await conversation.update({ status: fixture.status, hitl: fixture.hitl }, { transaction, silent: true });
    }

    const messageId = stableId(`${fixture.key}:message`);
    const existingMessage = await Message.findOne({ where: { id: messageId }, transaction });
    if (!existingMessage) {
        // A single, unanswered customer message with no reply — this is what
        // deriveWorkflowProjection() (conversation.service.js) reads as
        // needs_merchant_reply: true with zero active provider attempts.
        await Message.create({
            id: messageId,
            conversation_id: conversation.id,
            content: fixture.message,
            sender: 'customer',
            created_at: createdAt,
        }, { transaction, silent: true });
    }
    return conversation;
}

async function ensureRtoBlacklistEntry(shop, fixture, transaction) {
    const id = stableId('rto-blacklist:draft-risky');
    const phone = normalizePhone(fixture.phone);
    const defaults = {
        id,
        phone,
        reason: fixture.reason,
        risk_score: fixture.risk_score,
        is_global: false,
        shop_id: shop.id,
    };
    let entry = await RtoBlacklist.findOne({ where: { id }, transaction });
    if (!entry) {
        entry = await RtoBlacklist.create(defaults, { transaction });
    } else {
        await entry.update({ risk_score: fixture.risk_score, reason: fixture.reason }, { transaction });
    }
    return entry;
}

async function ensureSecondShop(transaction) {
    const marker = { mobile_dev_seed: SEED_KEY };
    const tenantId = stableId(SECOND_SHOP.tenantScope);
    await Tenant.findOrCreate({
        where: { id: tenantId },
        defaults: { id: tenantId, name: 'EasyMod Mobile Dev Tenant B', is_active: true, settings: marker },
        transaction,
    });

    const shopId = stableId(SECOND_SHOP.shopScope);
    const [shop] = await Shop.findOrCreate({
        where: { id: shopId },
        defaults: {
            id: shopId,
            unique_code: SECOND_SHOP.code,
            tenant_id: tenantId,
            shop_name: SECOND_SHOP.name,
            name: SECOND_SHOP.name,
            is_active: true,
            timezone: 'Asia/Dhaka',
            settings: marker,
        },
        transaction,
    });

    const ownerId = stableId(SECOND_SHOP.ownerScope);
    const hashedPassword = await hashPassword(OWNER_PASSWORD);
    const [owner, created] = await User.findOrCreate({
        where: { id: ownerId },
        defaults: {
            id: ownerId,
            email: SECOND_SHOP.ownerEmail,
            password: hashedPassword,
            full_name: 'Mobile Dev Owner B (Seed)',
            token_version: 1,
            last_logged_shop_id: shopId,
        },
        transaction,
    });
    if (!created) {
        await owner.update({ password: hashedPassword, last_logged_shop_id: shopId, settings: {} }, { transaction });
    }

    const membershipId = stableId(SECOND_SHOP.membershipScope);
    const [membership] = await UserShop.findOrCreate({
        where: { id: membershipId },
        defaults: { id: membershipId, user_id: ownerId, shop_id: shopId, role: 'owner', is_active: true },
        transaction,
    });
    if (!membership.is_active) await membership.update({ is_active: true }, { transaction });

    await ensureProduct(shop, {
        key: SECOND_SHOP.productScope,
        name: 'Shop B Only Item (Seed)',
        price: 990,
        quantity: 1,
        low_stock_threshold: 5,
        track_quantity: true,
        is_active: true,
    }, transaction);

    return { shop, owner };
}

async function removeSecondShop(transaction) {
    await Product.destroy({ where: { id: stableId(SECOND_SHOP.productScope) }, force: true, transaction });
    await UserShop.destroy({ where: { id: stableId(SECOND_SHOP.membershipScope) }, transaction });
    await User.destroy({ where: { id: stableId(SECOND_SHOP.ownerScope) }, transaction });
    await Shop.destroy({ where: { id: stableId(SECOND_SHOP.shopScope) }, transaction });
    await Tenant.destroy({ where: { id: stableId(SECOND_SHOP.tenantScope) }, transaction });
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function seed() {
    const now = new Date();
    const fixtures = buildFixtures(now);

    const result = await sequelize.transaction(async (transaction) => {
        const tenant = await ensureTenant(transaction);
        const shop = await ensureShop(tenant, transaction);
        const owner = await ensureOwnerUser(transaction);
        await ensureOwnerMembership(owner, shop, transaction);

        const customers = {};
        for (const [key, fixture] of Object.entries(fixtures.customers)) {
            customers[key] = await ensureCustomer(shop, fixture, transaction);
        }

        for (const fixture of Object.values(fixtures.products)) {
            await ensureProduct(shop, fixture, transaction);
        }

        const orders = {};
        for (const fixture of Object.values(fixtures.orders)) {
            orders[fixture.key] = await ensureOrder(shop, fixture, customers[fixture.customerKey], now, transaction);
        }

        for (const fixture of Object.values(fixtures.courierDispatches)) {
            const order = orders[fixtures.orders[fixture.orderKey].key];
            await ensureCourierDispatch(shop, fixture, order, now, transaction);
        }

        for (const fixture of Object.values(fixtures.conversations)) {
            await ensureConversationWithMessage(shop, fixture, customers[fixture.customerKey], now, transaction);
        }

        const rtoCustomer = fixtures.customers[fixtures.rtoBlacklistEntry.customerKey];
        await ensureRtoBlacklistEntry(shop, { ...fixtures.rtoBlacklistEntry, phone: rtoCustomer.phone }, transaction);

        // Deliberately NOT creating any DeliveryIntegration row for this shop —
        // that absence is exactly what trips courier-readiness.service.js's
        // SETUP_INCOMPLETE path (verified below, outside the transaction).

        const secondShop = await ensureSecondShop(transaction);

        return { shop, owner, secondShop };
    });

    return result;
}

async function verify(shop) {
    const lines = [];
    try {
        const readiness = await courierReadiness.getReadiness(shop.id);
        lines.push(`courier-readiness: ready=${readiness.ready} status=${readiness.status} missing=[${readiness.missing.join(', ')}]`);
        if (readiness.ready) {
            lines.push('WARNING: expected SETUP_INCOMPLETE (no DeliveryIntegration seeded) but readiness.ready === true');
        }
    } catch (error) {
        lines.push(`WARNING: courier-readiness verification threw: ${error.message}`);
    }

    try {
        const fixtures = buildFixtures(new Date());
        const rtoCustomer = fixtures.customers[fixtures.rtoBlacklistEntry.customerKey];
        const check = await RtoShieldService.checkPhone(rtoCustomer.phone, shop.id);
        lines.push(`RtoShieldService.checkPhone(${rtoCustomer.phone}): tier=${check.tier} risk_score=${check.risk_score}`);
        if (check.tier !== 'verify') {
            lines.push(`WARNING: expected tier "verify" but got "${check.tier}"`);
        }
    } catch (error) {
        lines.push(`WARNING: RTO shield verification threw: ${error.message}`);
    }
    return lines;
}

// ── Removal ──────────────────────────────────────────────────────────────────

async function remove() {
    const shopId = stableId('shop');
    await sequelize.transaction(async (transaction) => {
        const fixtures = buildFixtures(new Date());

        for (const fixture of Object.values(fixtures.conversations)) {
            const conversationId = stableId(fixture.key);
            await Message.destroy({ where: { conversation_id: conversationId }, transaction });
            await Conversation.destroy({ where: { id: conversationId }, transaction });
        }
        for (const fixture of Object.values(fixtures.courierDispatches)) {
            await CourierDispatch.destroy({ where: { id: stableId(fixture.key) }, transaction });
        }
        for (const fixture of Object.values(fixtures.orders)) {
            await Order.destroy({ where: { id: stableId(fixture.key) }, transaction });
        }
        await RtoBlacklist.destroy({ where: { id: stableId('rto-blacklist:draft-risky') }, transaction });
        for (const fixture of Object.values(fixtures.products)) {
            await Product.destroy({ where: { id: stableId(fixture.key) }, force: true, transaction });
        }
        for (const fixture of Object.values(fixtures.customers)) {
            await Customer.destroy({ where: { id: stableId(fixture.key) }, transaction });
        }
        await removeSecondShop(transaction);
        await UserShop.destroy({ where: { id: stableId('user-shop:owner') }, transaction });
        await Shop.destroy({ where: { id: shopId }, transaction });
        await Tenant.destroy({ where: { id: stableId('tenant') }, transaction });
        await User.destroy({ where: { id: stableId('user:owner') }, transaction });
    });
    console.log('MOBILE_DEV_SEED=REMOVED');
}

// ── Entrypoint ───────────────────────────────────────────────────────────────

async function main() {
    assertNeverProduction();
    assertDisposablePostgres();
    await sequelize.authenticate();

    if (process.argv.includes('--remove')) {
        await remove();
        return;
    }

    const { shop, owner } = await seed();
    const verifyLines = await verify(shop);

    console.log('MOBILE_DEV_SEED=PASS');
    console.log(`SHOP_ID=${shop.id}`);
    console.log(`SHOP_CODE=${shop.unique_code}`);
    console.log(`OWNER_EMAIL=${owner.email}`);
    console.log(`SECOND_SHOP_CODE=${SECOND_SHOP.code} SECOND_OWNER_EMAIL=${SECOND_SHOP.ownerEmail}`);
    console.log('OWNER_PASSWORD=(MOBILE_DEV_SEED_PASSWORD env or default — dev/test only)');
    console.log('--- tier verification (read-only, not authoritative for Lane 2\'s endpoint) ---');
    verifyLines.forEach((line) => console.log(line));
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('MOBILE_DEV_SEED=FAIL');
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            try {
                await sequelize.close();
            } catch (closeError) {
                console.error('Error closing database connection:', closeError.message);
            }
        });
}

module.exports = {
    SEED_KEY,
    SHOP_CODE,
    OWNER_EMAIL,
    SECOND_SHOP,
    stableId,
    buildFixtures,
    seed,
    remove,
    verify,
};
