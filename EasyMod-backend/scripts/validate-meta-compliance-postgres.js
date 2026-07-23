'use strict';

require('module-alias/register');

const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../src/utils/database/database-setup');

const MODE = process.argv[2];
const SNAPSHOT_PATH = process.env.PHASE1_SCHEMA_SNAPSHOT;
const APP_SCOPED_USER_ID = 'phase1-synthetic-app-user';
const IDS = {
    tenant: '00000000-0000-4000-8000-000000000001',
    shop: '00000000-0000-4000-8000-000000000101',
    user: '00000000-0000-4000-8000-000000000201',
    channelWithOrder: '00000000-0000-4000-8000-000000000301',
    channelWithoutOrder: '00000000-0000-4000-8000-000000000302',
    customerWithOrder: '00000000-0000-4000-8000-000000000401',
    customerWithoutOrder: '00000000-0000-4000-8000-000000000402',
    conversationWithOrder: '00000000-0000-4000-8000-000000000501',
    conversationWithoutOrder: '00000000-0000-4000-8000-000000000502',
    messageWithOrder: '00000000-0000-4000-8000-000000000601',
    messageWithoutOrder: '00000000-0000-4000-8000-000000000602',
    order: '00000000-0000-4000-8000-000000000701',
    notification: '00000000-0000-4000-8000-000000000801',
    payment: '00000000-0000-4000-8000-000000000901',
};
const PSID_WITH_ORDER = 'phase1-psid-with-order';
const PSID_WITHOUT_ORDER = 'phase1-psid-without-order';
const ATTACHMENT_DIR = path.resolve(
    __dirname,
    '../uploads/conversation-attachments/phase1-validation',
);
const ATTACHMENTS = [
    path.join(ATTACHMENT_DIR, 'with-order.txt'),
    path.join(ATTACHMENT_DIR, 'without-order.txt'),
];

async function query(sql, replacements = []) {
    const result = await sequelize.query(sql, { replacements });
    // PostgreSQL SHOW returns a direct row array; SELECT returns
    // [rows, metadata]. Normalize both without changing query semantics.
    return Array.isArray(result[0]) ? result[0] : result;
}

async function captureSchema() {
    return {
        tables: await query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `),
        columns: await query(`
            SELECT table_name, ordinal_position, column_name, data_type, udt_name,
                   is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `),
        constraints: await query(`
            SELECT c.conrelid::regclass::text AS table_name,
                   c.conname AS constraint_name,
                   c.contype AS constraint_type,
                   pg_get_constraintdef(c.oid) AS definition
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'public'
            ORDER BY table_name, constraint_name
        `),
        indexes: await query(`
            SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY table_name, index_name
        `),
        enums: await query(`
            SELECT t.typname AS enum_name, e.enumsortorder, e.enumlabel
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public'
            ORDER BY enum_name, e.enumsortorder
        `),
    };
}

async function assertPostgres15() {
    const [{ server_version: version }] = await query('SHOW server_version');
    assert.match(version, /^15\./, `Expected PostgreSQL 15, received ${version}`);
    return version;
}

async function seedBaseline() {
    assert.ok(SNAPSHOT_PATH, 'PHASE1_SCHEMA_SNAPSHOT is required');
    const version = await assertPostgres15();
    const schema = await captureSchema();
    await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');

    await sequelize.transaction(async (transaction) => {
        const options = { transaction };
        await sequelize.query(
            `INSERT INTO tenants (id, name) VALUES (?, ?)`,
            { replacements: [IDS.tenant, 'Phase 1 Synthetic Tenant'], ...options },
        );
        await sequelize.query(
            `INSERT INTO shops (id, unique_code, tenant_id, shop_name, name)
             VALUES (?, ?, ?, ?, ?)`,
            {
                replacements: [
                    IDS.shop,
                    'P1SYNTH',
                    IDS.tenant,
                    'Phase 1 Synthetic Shop',
                    'Phase 1 Synthetic Shop',
                ],
                ...options,
            },
        );
        await sequelize.query(
            `INSERT INTO users (id, email, password, name, full_name, is_verified)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            {
                replacements: [
                    IDS.user,
                    'phase1-synthetic@example.invalid',
                    'synthetic-not-a-login-secret',
                    'Phase 1 Synthetic Owner',
                    'Phase 1 Synthetic Owner',
                ],
                ...options,
            },
        );
        await sequelize.query(
            `INSERT INTO user_shops (user_id, shop_id, role, is_active)
             VALUES (?, ?, 'owner', TRUE)`,
            { replacements: [IDS.user, IDS.shop], ...options },
        );
        for (const [id, assetId, displayName, verifyToken] of [
            [IDS.channelWithOrder, 'phase1-page-with-order', 'Synthetic Page With Order', 'phase1-verify-1'],
            [IDS.channelWithoutOrder, 'phase1-page-no-order', 'Synthetic Page Without Order', 'phase1-verify-2'],
        ]) {
            await sequelize.query(
                `INSERT INTO meta_channels (
                    id, shop_id, platform, meta_asset_id, display_name,
                    webhook_verify_token, status, connected_by_user_id, connected_at
                 ) VALUES (?, ?, 'facebook', ?, ?, ?, 'CONNECTED', ?, NOW())`,
                {
                    replacements: [id, IDS.shop, assetId, displayName, verifyToken, IDS.user],
                    ...options,
                },
            );
        }
        for (const [id, psid, name, phone, email] of [
            [
                IDS.customerWithOrder,
                PSID_WITH_ORDER,
                'Synthetic Customer With Order',
                '01700000001',
                'with-order@example.invalid',
            ],
            [
                IDS.customerWithoutOrder,
                PSID_WITHOUT_ORDER,
                'Synthetic Customer Without Order',
                '01700000002',
                'without-order@example.invalid',
            ],
        ]) {
            await sequelize.query(
                `INSERT INTO customers (
                    id, shop_id, name, channel_type, channel_user_id,
                    phone, email, messaging_consent
                 ) VALUES (?, ?, ?, 'messenger', ?, ?, ?, CAST(? AS JSONB))`,
                {
                    replacements: [
                        id,
                        IDS.shop,
                        name,
                        psid,
                        phone,
                        email,
                        JSON.stringify({ facebook: { opted_in: true } }),
                    ],
                    ...options,
                },
            );
            await sequelize.query(
                `INSERT INTO customer_preferences (
                    customer_id, shop_id, preferences, notes
                 ) VALUES (?, ?, CAST(? AS JSONB), ?)`,
                {
                    replacements: [
                        id,
                        IDS.shop,
                        JSON.stringify({ synthetic: true }),
                        'Synthetic preference PII',
                    ],
                    ...options,
                },
            );
            await sequelize.query(
                `INSERT INTO customer_delivery_stats (
                    shop_id, phone, total_orders, delivered_orders
                 ) VALUES (?, ?, 1, 1)`,
                { replacements: [IDS.shop, phone], ...options },
            );
        }
        for (const [id, customerId, channelId] of [
            [IDS.conversationWithOrder, IDS.customerWithOrder, IDS.channelWithOrder],
            [IDS.conversationWithoutOrder, IDS.customerWithoutOrder, IDS.channelWithoutOrder],
        ]) {
            await sequelize.query(
                `INSERT INTO conversations (
                    id, shop_id, customer_id, channel, status, meta_channel_id
                 ) VALUES (?, ?, ?, 'facebook', 'open', ?)`,
                { replacements: [id, IDS.shop, customerId, channelId], ...options },
            );
        }
        await sequelize.query(
            `INSERT INTO messages (
                id, conversation_id, customer_id, content, sender, external_id, metadata
             ) VALUES (?, ?, ?, ?, 'customer', ?, CAST(? AS JSONB))`,
            {
                replacements: [
                    IDS.messageWithOrder,
                    IDS.conversationWithOrder,
                    IDS.customerWithOrder,
                    'Synthetic message with order',
                    'phase1-message-1',
                    JSON.stringify({
                        image_url: '/uploads/conversation-attachments/phase1-validation/with-order.txt',
                        remote_reference: 'https://lookaside.fbsbx.com/synthetic-not-fetched',
                    }),
                ],
                ...options,
            },
        );
        await sequelize.query(
            `INSERT INTO messages (
                id, conversation_id, customer_id, content, sender, external_id, metadata
             ) VALUES (?, ?, ?, ?, 'customer', ?, CAST(? AS JSONB))`,
            {
                replacements: [
                    IDS.messageWithoutOrder,
                    IDS.conversationWithoutOrder,
                    IDS.customerWithoutOrder,
                    'Synthetic message without order',
                    'phase1-message-2',
                    JSON.stringify({
                        file_url: '/uploads/conversation-attachments/phase1-validation/without-order.txt',
                    }),
                ],
                ...options,
            },
        );
        await sequelize.query(
            `INSERT INTO orders (
                id, shop_id, customer_id, order_number, total_amount, cod_amount,
                delivery_charge, discount, subtotal, tax, delivery_fee, total,
                customer_name, customer_phone, delivery_address, delivery_area,
                delivery_zone, delivery_location, note, notes, payment_method,
                payment_status, order_status
             ) VALUES (
                ?, ?, ?, ?, 1250.00, 1000.00, 100.00, 50.00, 1200.00, 25.00,
                75.00, 1250.00, ?, ?, ?, ?, ?, ?, ?, ?, 'bkash', 'paid', 'confirmed'
             )`,
            {
                replacements: [
                    IDS.order,
                    IDS.shop,
                    IDS.customerWithOrder,
                    'PHASE1-SYNTHETIC-ORDER',
                    'Synthetic Customer With Order',
                    '01700000001',
                    'Synthetic delivery address',
                    'Synthetic delivery area',
                    'DHAKA',
                    'Synthetic location',
                    'Synthetic note',
                    'Synthetic legacy notes',
                ],
                ...options,
            },
        );
        await sequelize.query(
            `INSERT INTO owner_notifications (
                id, shop_id, type, customer_message, customer_data, status, owner_info
             ) VALUES (?, ?, 'payment_confirmation', ?, CAST(? AS JSONB), 'completed', CAST(? AS JSONB))`,
            {
                replacements: [
                    IDS.notification,
                    IDS.shop,
                    'Synthetic customer payment message',
                    JSON.stringify({
                        orderId: IDS.order,
                        orderNumber: 'PHASE1-SYNTHETIC-ORDER',
                        customerName: 'Synthetic Customer With Order',
                        customerPhone: '01700000001',
                        amount: '1250.00',
                        paymentMethod: 'bkash',
                        transactionId: 'phase1-synthetic-trx',
                        screenshotUrl: 'https://example.invalid/synthetic.png',
                    }),
                    JSON.stringify({ email: 'owner@example.invalid' }),
                ],
                ...options,
            },
        );
        for (const [customerId, channelId] of [
            [IDS.customerWithOrder, IDS.channelWithOrder],
            [IDS.customerWithoutOrder, IDS.channelWithoutOrder],
        ]) {
            await sequelize.query(
                `INSERT INTO meta_channel_consent_events (
                    shop_id, channel_id, customer_id, event, source, metadata
                 ) VALUES (?, ?, ?, 'OPT_IN_IMPLICIT', 'message', CAST(? AS JSONB))`,
                {
                    replacements: [
                        IDS.shop,
                        channelId,
                        customerId,
                        JSON.stringify({ synthetic: true }),
                    ],
                    ...options,
                },
            );
        }
        await sequelize.query(
            `INSERT INTO audit_logs (
                shop_id, user_id, action, resource_type, resource_id, metadata
             ) VALUES (?, ?, 'phase1_synthetic_pre_migration', 'validation', ?, CAST(? AS JSONB))`,
            {
                replacements: [
                    IDS.shop,
                    IDS.user,
                    IDS.shop,
                    JSON.stringify({ synthetic: true }),
                ],
                ...options,
            },
        );
    });

    console.log(JSON.stringify({
        result: 'baseline-seeded',
        postgresVersion: version,
        synthetic: true,
        connectedChannels: 2,
        customers: 2,
        customersWithOrders: 1,
        customersWithoutOrders: 1,
        conversations: 2,
        messages: 2,
        attachmentsRepresented: 2,
    }));
}

function byName(rows, nameField) {
    return new Map(rows.map((row) => [row[nameField], row]));
}

async function verifyComplianceSchema() {
    const tables = new Set((await query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    `)).map((row) => row.table_name));
    assert.ok(tables.has('meta_user_identities'));
    assert.ok(tables.has('meta_data_deletion_requests'));

    const columns = await query(`
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('meta_user_identities', 'meta_data_deletion_requests')
        ORDER BY table_name, ordinal_position
    `);
    const columnMap = new Map(columns.map((row) => [
        `${row.table_name}.${row.column_name}`,
        row,
    ]));
    for (const required of [
        'meta_user_identities.id',
        'meta_user_identities.app_scoped_user_id',
        'meta_user_identities.page_scoped_user_id',
        'meta_user_identities.internal_user_id',
        'meta_user_identities.shop_id',
        'meta_user_identities.channel_id',
        'meta_user_identities.source',
        'meta_user_identities.last_verified_at',
        'meta_data_deletion_requests.request_fingerprint',
        'meta_data_deletion_requests.identity_hash',
        'meta_data_deletion_requests.confirmation_code_hash',
        'meta_data_deletion_requests.status',
        'meta_data_deletion_requests.pending_attachment_paths',
        'meta_data_deletion_requests.data_phase_completed_at',
        'meta_data_deletion_requests.completed_at',
    ]) {
        assert.ok(columnMap.has(required), `Missing column ${required}`);
    }
    assert.equal(
        columnMap.get('meta_user_identities.page_scoped_user_id').is_nullable,
        'YES',
    );
    assert.match(
        columnMap.get('meta_user_identities.source').column_default,
        /facebook_oauth/,
    );
    assert.match(
        columnMap.get('meta_user_identities.last_verified_at').column_default,
        /now\(\)/i,
    );
    assert.match(
        columnMap.get('meta_data_deletion_requests.status').column_default,
        /PENDING/,
    );
    assert.match(
        columnMap.get('meta_data_deletion_requests.pending_attachment_paths').column_default,
        /\[\]/,
    );

    const enumRows = await query(`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'enum_meta_data_deletion_requests_status'
        ORDER BY e.enumsortorder
    `);
    assert.deepEqual(
        enumRows.map((row) => row.enumlabel),
        ['PENDING', 'PROCESSING', 'IDENTITY_NOT_RESOLVED', 'COMPLETED', 'FAILED'],
    );

    const indexes = byName(await query(`
        SELECT indexname AS index_name, indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('meta_user_identities', 'meta_data_deletion_requests')
    `), 'index_name');
    for (const indexName of [
        'uq_meta_user_identities_app_channel',
        'idx_meta_user_identities_shop_psid',
        'idx_meta_user_identities_internal_user',
        'idx_meta_deletion_identity_hash',
        'idx_meta_deletion_status_created',
    ]) {
        assert.ok(indexes.has(indexName), `Missing index ${indexName}`);
    }
    assert.match(
        indexes.get('uq_meta_user_identities_app_channel').definition,
        /UNIQUE/i,
    );

    const constraints = await query(`
        SELECT c.conrelid::regclass::text AS table_name,
               c.contype AS constraint_type,
               pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        WHERE c.conrelid IN (
            'meta_user_identities'::regclass,
            'meta_data_deletion_requests'::regclass
        )
        ORDER BY table_name, constraint_type, definition
    `);
    const definitions = constraints.map((row) => `${row.table_name}:${row.definition}`);
    assert.ok(definitions.some((value) =>
        /meta_user_identities:FOREIGN KEY \(internal_user_id\).*users\(id\).*ON DELETE SET NULL/i
            .test(value)));
    assert.ok(definitions.some((value) =>
        /meta_user_identities:FOREIGN KEY \(shop_id\).*shops\(id\).*ON DELETE CASCADE/i
            .test(value)));
    assert.ok(definitions.some((value) =>
        /meta_user_identities:FOREIGN KEY \(channel_id\).*meta_channels\(id\).*ON DELETE CASCADE/i
            .test(value)));
    assert.ok(definitions.some((value) =>
        /meta_data_deletion_requests:UNIQUE \(request_fingerprint\)/i.test(value)));
    assert.ok(definitions.some((value) =>
        /meta_data_deletion_requests:UNIQUE \(confirmation_code_hash\)/i.test(value)));

    return {
        tablesVerified: 2,
        columnsVerified: columns.length,
        indexesVerified: 5,
        foreignKeysVerified: 3,
        uniqueControlsVerified: 3,
        enumLabelsVerified: enumRows.length,
    };
}

async function createIdentityMappings() {
    const { MetaUserIdentity } = require('../src/modules/entities');
    const mappings = await Promise.all([
        MetaUserIdentity.create({
            app_scoped_user_id: APP_SCOPED_USER_ID,
            page_scoped_user_id: PSID_WITH_ORDER,
            internal_user_id: IDS.user,
            shop_id: IDS.shop,
            channel_id: IDS.channelWithOrder,
        }),
        MetaUserIdentity.create({
            app_scoped_user_id: APP_SCOPED_USER_ID,
            page_scoped_user_id: PSID_WITHOUT_ORDER,
            internal_user_id: IDS.user,
            shop_id: IDS.shop,
            channel_id: IDS.channelWithoutOrder,
        }),
    ]);
    assert.equal(mappings.length, 2);
    await assert.rejects(
        MetaUserIdentity.create({
            app_scoped_user_id: APP_SCOPED_USER_ID,
            page_scoped_user_id: PSID_WITH_ORDER,
            internal_user_id: IDS.user,
            shop_id: IDS.shop,
            channel_id: IDS.channelWithOrder,
        }),
        /unique|duplicate/i,
    );
}

async function verifyUpAndSyntheticDeletion() {
    const version = await assertPostgres15();
    const schema = await verifyComplianceSchema();
    const entities = require('../src/modules/entities');
    const adminService = require('../src/modules/admin/admin.service');
    const complianceService = require('../src/modules/integration/meta-compliance.service');
    const paymentReconciliation = require(
        '../src/modules/payment/payment-processing-reconciliation.service',
    );

    await createIdentityMappings();
    const mappingRows = await entities.MetaUserIdentity.findAll({
        where: { app_scoped_user_id: APP_SCOPED_USER_ID },
    });
    assert.equal(mappingRows.length, 2, 'Entity read must match both mappings');

    const readiness = await adminService.getMetaIdentityReadiness();
    assert.deepEqual({
        totalConnectedChannels: readiness.totalConnectedChannels,
        channelsWithValidMappings: readiness.channelsWithValidMappings,
        connectedChannelsMissingMappings: readiness.connectedChannelsMissingMappings,
        ready: readiness.ready,
    }, {
        totalConnectedChannels: 2,
        channelsWithValidMappings: 2,
        connectedChannelsMissingMappings: 0,
        ready: true,
    });

    await fs.mkdir(ATTACHMENT_DIR, { recursive: true });
    await Promise.all(ATTACHMENTS.map((file) => fs.writeFile(file, 'synthetic', 'utf8')));

    const result = await complianceService.processDeletionRequest({
        signedRequest: 'phase1.synthetic.signed-request',
        appScopedUserId: APP_SCOPED_USER_ID,
        appSecret: 'phase1-synthetic-app-secret',
    });
    assert.equal(result.request.status, 'COMPLETED');
    assert.equal(result.request.matched_customer_count, 2);
    assert.equal(result.request.conversations_deleted_count, 2);
    assert.equal(result.request.messages_deleted_count, 2);
    assert.equal(result.request.orders_anonymized_count, 1);
    assert.equal(result.request.attachments_deleted_count, 2);

    const status = await complianceService.getDeletionStatus(result.confirmationCode);
    assert.deepEqual({
        status: status.status,
        matchedCustomers: status.matched_customers,
        ordersAnonymized: status.orders_anonymized,
        retryable: status.retryable,
    }, {
        status: 'completed',
        matchedCustomers: 2,
        ordersAnonymized: 1,
        retryable: false,
    });

    const [{ count: customerCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM customers WHERE id IN (?, ?)`,
        [IDS.customerWithOrder, IDS.customerWithoutOrder],
    );
    const [{ count: conversationCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM conversations WHERE id IN (?, ?)`,
        [IDS.conversationWithOrder, IDS.conversationWithoutOrder],
    );
    const [{ count: messageCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM messages WHERE id IN (?, ?)`,
        [IDS.messageWithOrder, IDS.messageWithoutOrder],
    );
    const [{ count: preferenceCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM customer_preferences WHERE shop_id = ?`,
        [IDS.shop],
    );
    const [{ count: deliveryStatsCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM customer_delivery_stats WHERE shop_id = ?`,
        [IDS.shop],
    );
    assert.equal(customerCount, 0);
    assert.equal(conversationCount, 0);
    assert.equal(messageCount, 0);
    assert.equal(preferenceCount, 0);
    assert.equal(deliveryStatsCount, 0);

    const [order] = await query(`
        SELECT customer_id, customer_name, customer_phone, delivery_address,
               delivery_area, delivery_zone, delivery_location, note, notes,
               total_amount::text, cod_amount::text, delivery_charge::text,
               discount::text, subtotal::text, tax::text, delivery_fee::text,
               total::text, payment_status, order_status, order_number
        FROM orders WHERE id = ?
    `, [IDS.order]);
    assert.ok(order, 'Financial order record must be retained');
    assert.equal(order.customer_id, null);
    assert.equal(order.customer_name, 'Deleted customer');
    for (const field of [
        'customer_phone',
        'delivery_address',
        'delivery_area',
        'delivery_zone',
        'delivery_location',
        'note',
        'notes',
    ]) {
        assert.equal(order[field], null, `Expected order.${field} to be anonymized`);
    }
    assert.deepEqual({
        totalAmount: order.total_amount,
        codAmount: order.cod_amount,
        deliveryCharge: order.delivery_charge,
        discount: order.discount,
        subtotal: order.subtotal,
        tax: order.tax,
        deliveryFee: order.delivery_fee,
        total: order.total,
        paymentStatus: order.payment_status,
        orderStatus: order.order_status,
        orderNumber: order.order_number,
    }, {
        totalAmount: '1250.00',
        codAmount: '1000.00',
        deliveryCharge: '100.00',
        discount: '50.00',
        subtotal: '1200.00',
        tax: '25.00',
        deliveryFee: '75.00',
        total: '1250.00',
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        orderNumber: 'PHASE1-SYNTHETIC-ORDER',
    });

    const [notification] = await query(`
        SELECT customer_message, customer_data, owner_info
        FROM owner_notifications WHERE id = ?
    `, [IDS.notification]);
    assert.equal(notification.customer_message, null);
    assert.equal(notification.owner_info, null);
    assert.equal(notification.customer_data.customerDeleted, true);
    assert.equal(notification.customer_data.customerName, undefined);
    assert.equal(notification.customer_data.customerPhone, undefined);
    assert.equal(notification.customer_data.screenshotUrl, undefined);

    const consentRows = await query(`
        SELECT event, source, customer_id
        FROM meta_channel_consent_events
        WHERE shop_id = ?
        ORDER BY created_at, event
    `, [IDS.shop]);
    assert.equal(consentRows.length, 4);
    assert.equal(consentRows.filter((row) => row.event === 'DATA_DELETED').length, 2);
    assert.ok(consentRows.every((row) => row.customer_id === null));

    const auditRows = await query(`
        SELECT action
        FROM audit_logs
        WHERE resource_type = 'meta_data_deletion_request'
        ORDER BY created_at, action
    `);
    const actions = new Set(auditRows.map((row) => row.action));
    for (const action of [
        'meta_deletion_request_received',
        'meta_deletion_signed_request_validated',
        'meta_deletion_identity_resolved',
        'meta_deletion_shop_data_removed',
        'meta_deletion_completed',
    ]) {
        assert.ok(actions.has(action), `Missing audit action ${action}`);
    }
    assert.equal(actions.has('meta_deletion_identity_not_resolved'), false);

    const [{ count: mappingCount }] = await query(
        `SELECT COUNT(*)::int AS count FROM meta_user_identities`,
    );
    assert.equal(mappingCount, 0);
    for (const file of ATTACHMENTS) {
        await assert.rejects(fs.access(file), /ENOENT/);
    }

    await query(`
        INSERT INTO payment_transactions (
            id, order_id, shop_id, payment_method, payment_gateway,
            transaction_id, amount, status, updated_at
        ) VALUES (?, ?, ?, 'bkash', 'bkash', ?, 1250.00, 'processing', NOW() - INTERVAL '60 minutes')
    `, [IDS.payment, IDS.order, IDS.shop, 'phase1-synthetic-payment']);
    const paymentReport = await paymentReconciliation.getStalePaymentProcessingReport({
        olderThanMinutes: 15,
        limit: 10,
        now: new Date(),
    });
    assert.equal(paymentReport.total, 1);
    assert.equal(paymentReport.items[0].paymentId, IDS.payment);
    assert.ok(paymentReport.items[0].ageMinutes >= 59);
    const [paymentAfterReport] = await query(
        `SELECT status FROM payment_transactions WHERE id = ?`,
        [IDS.payment],
    );
    assert.equal(paymentAfterReport.status, 'processing');

    console.log(JSON.stringify({
        result: 'up-and-synthetic-deletion-verified',
        postgresVersion: version,
        schema,
        entityMappingsVerified: 2,
        identityReadiness: readiness,
        deletion: {
            matchedCustomers: 2,
            conversationsDeleted: 2,
            messagesDeleted: 2,
            ordersAnonymized: 1,
            attachmentsDeleted: 2,
            retainedFinancialOrder: true,
        },
        stalePaymentReport: {
            total: paymentReport.total,
            mutationPerformed: false,
        },
    }));
}

async function verifyDown() {
    assert.ok(SNAPSHOT_PATH, 'PHASE1_SCHEMA_SNAPSHOT is required');
    const baseline = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
    const current = await captureSchema();
    assert.deepEqual(current, baseline);
    const [{ request_table, identity_table, status_enum }] = await query(`
        SELECT
            to_regclass('public.meta_data_deletion_requests') AS request_table,
            to_regclass('public.meta_user_identities') AS identity_table,
            to_regtype('public.enum_meta_data_deletion_requests_status') AS status_enum
    `);
    assert.equal(request_table, null);
    assert.equal(identity_table, null);
    assert.equal(status_enum, null);
    const [order] = await query(
        `SELECT order_number, total::text, customer_id FROM orders WHERE id = ?`,
        [IDS.order],
    );
    assert.ok(order, 'Deletion effects on retained order must survive schema rollback');
    assert.equal(order.total, '1250.00');
    assert.equal(order.customer_id, null);
    console.log(JSON.stringify({
        result: 'down-verified',
        baselineSchemaRestoredExactly: true,
        removedTables: 2,
        removedEnums: 1,
        retainedOrderStillPresent: true,
    }));
}

async function verifyReapply() {
    const version = await assertPostgres15();
    const schema = await verifyComplianceSchema();
    const { MetaUserIdentity } = require('../src/modules/entities');
    const mapping = await MetaUserIdentity.create({
        app_scoped_user_id: 'phase1-reapply-entity-check',
        page_scoped_user_id: 'phase1-reapply-psid',
        internal_user_id: IDS.user,
        shop_id: IDS.shop,
        channel_id: IDS.channelWithOrder,
    });
    assert.equal(mapping.source, 'facebook_oauth');
    assert.ok(mapping.last_verified_at);
    await MetaUserIdentity.destroy({ where: { id: mapping.id } });
    console.log(JSON.stringify({
        result: 'reapply-verified',
        postgresVersion: version,
        schema,
        entityCreateReadDeleteCompatible: true,
    }));
}

async function main() {
    await sequelize.authenticate();
    switch (MODE) {
        case 'seed-baseline':
            await seedBaseline();
            break;
        case 'verify-up':
            await verifyUpAndSyntheticDeletion();
            break;
        case 'verify-down':
            await verifyDown();
            break;
        case 'verify-reapply':
            await verifyReapply();
            break;
        default:
            throw new Error(
                'Usage: node scripts/validate-meta-compliance-postgres.js '
                + '<seed-baseline|verify-up|verify-down|verify-reapply>',
            );
    }
}

async function closeLoadedConnections() {
    await sequelize.close().catch(() => {});

    const messageQueuePath = require.resolve('../src/jobs/message-queue');
    const loadedMessageQueue = require.cache[messageQueuePath];
    if (loadedMessageQueue?.exports?.messageQueue?.close) {
        await loadedMessageQueue.exports.messageQueue.close().catch(() => {});
    }

    const optionalClosers = [
        ['../src/config/redis', 'closeAllRedis'],
        ['../src/utils/redis-client', 'closeRedis'],
    ];

    for (const [modulePath, closeMethod] of optionalClosers) {
        const resolvedPath = require.resolve(modulePath);
        const loadedModule = require.cache[resolvedPath];
        if (loadedModule?.exports?.[closeMethod]) {
            await loadedModule.exports[closeMethod]().catch(() => {});
        }
    }
}

main()
    .then(() => closeLoadedConnections())
    .catch(async (error) => {
        console.error(`Phase 1 PostgreSQL validation failed: ${error.message}`);
        await closeLoadedConnections();
        process.exit(1);
    });
