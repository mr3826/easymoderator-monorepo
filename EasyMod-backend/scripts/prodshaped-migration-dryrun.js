'use strict';

/**
 * Release-engineering dry-run: full migration chain against a disposable,
 * production-SHAPED PostgreSQL dataset.
 *
 * The regular integration gate proves the chain applies to an EMPTY database.
 * This script proves it against data that looks like production: multiple
 * tenants, hundreds of orders across every status with 90-day-spread
 * timestamps, JSONB delivery addresses/metadata, agent orders carrying
 * idempotency keys — including the same key value used by two DIFFERENT shops
 * (allowed) — and then exercises the new invariant from both directions:
 *
 *   A. the partial unique index exists and enforces within-shop duplicates at
 *      the database level (23505) while cross-shop reuse stays legal;
 *   B. migration.up REFUSES LOUDLY when pre-existing duplicates are present
 *      (reconcile-before-deploy), and succeeds once they are resolved;
 *   C. down/up round-trips cleanly, leaving the schema identical.
 *
 * Everything runs on the same disposable compose stack as the integration
 * gate; the database name carries `_test` and the disposable guard re-checks
 * it before any write. Nothing here can touch a real catalog.
 */

const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const composeFile = path.join(repoRoot, 'docker-compose.test.yml');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const project = `easymod-prodshaped-${process.pid}`;

const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(String(port)));
    });
});

const sha = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function run(command, args, env, cwd) {
    const options = { env, stdio: 'inherit', cwd: cwd || repoRoot, windowsHide: true };
    if (process.platform === 'win32' && command.endsWith('.cmd')) options.shell = true;
    const result = spawnSync(command, args, options);
    if (result.error) throw result.error;
    return result.status ?? 1;
}

async function main() {
    const postgresPort = await freePort();
    const redisPort = await freePort();
    const dbName = `easymod_prodshaped_${process.pid}_test`;
    const user = 'e2e';
    const password = 'e2e';
    const databaseUrl = `postgres://${user}:${password}@127.0.0.1:${postgresPort}/${dbName}`;

    const composeEnv = {
        ...process.env,
        TEST_POSTGRES_PORT: postgresPort,
        TEST_REDIS_PORT: redisPort,
        TEST_POSTGRES_USER: user,
        TEST_POSTGRES_PASSWORD: password,
        TEST_POSTGRES_DB: dbName,
    };
    const appEnv = {
        ...composeEnv,
        NODE_ENV: 'test',
        DB_SSL: 'false',
        DATABASE_URL: databaseUrl,
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        REDIS_SESSION_DB: '10',
        REDIS_CACHE_DB: '11',
        REDIS_RATELIMIT_DB: '12',
        REDIS_QUEUE_DB: '13',
        REDIS_LEGACY_DB: '14',
        REDIS_SSE_DB: '15',
    };
    const compose = (...args) => ['compose', '-p', project, '-f', composeFile, ...args];

    let servicesStarted = false;
    let failed = null;
    try {
        if (run('docker', compose('version'), composeEnv) !== 0) {
            throw new Error('Docker Compose is required for the production-shaped dry-run stack.');
        }
        servicesStarted = true;
        if (run('docker', compose('up', '-d', '--wait'), composeEnv) !== 0) {
            throw new Error('Disposable PostgreSQL/Redis services failed to become healthy.');
        }
        console.log('== 1/6 disposable stack up; running the FULL migration chain on an empty catalog');
        if (run(npmCommand, ['run', 'migrate', '--workspace=easymod-backend'], appEnv) !== 0) {
            throw new Error('npm run migrate failed on the empty catalog.');
        }

        Object.assign(process.env, appEnv);
        const { assertDisposableDatabase } = require('../tests/helpers/disposable-database');
        assertDisposableDatabase(databaseUrl, 'the production-shaped migration dry-run');
        const { sequelize } = require('../src/utils/database/database-setup');
        const { createFixtures } = require('../tests/helpers/pilot-intelligence.fixtures');
        const { Order } = require('../src/modules/entities');
        const migration = require('../src/database/migrations/20261026_001_order_idempotency_unique');
        const fx = createFixtures('PROD-SHAPED');

        const STATUSES = [
            ['draft', 'pending', 'unfulfilled'],
            ['pending', 'pending', 'unfulfilled'],
            ['confirmed', 'pending', 'unfulfilled'],
            ['confirmed', 'paid', 'shipped'],
            ['shipped', 'pending', 'shipped'],
            ['delivered', 'paid', 'delivered'],
            ['returned', 'paid', 'returned'],
            ['cancelled', 'pending', 'cancelled'],
        ];

        console.log('== 2/6 seeding production-shaped rows (3 shops, customers, 240 orders, 90-day spread)');
        const shops = [];
        for (let i = 0; i < 3; i += 1) {
            const shop = await fx.makeShop({ orderConfidenceMode: 'off' });
            await fx.makeMember(shop, 'owner');
            const customers = Array.from({ length: 5 }, (_, c) => fx.makeCustomer(shop, {
                name: `Customer ${i}-${c}`, phone: `0171${String(100000 + i * 1000 + c)}`,
            }));
            shops.push({ shop, customers: await Promise.all(customers) });
        }

        const seed = [];
        let counter = 0;
        for (const { shop, customers } of shops) {
            for (let n = 0; n < 80; n += 1) {
                const [order_status, payment_status, fulfillment_status] = STATUSES[n % STATUSES.length];
                const customer = customers[n % customers.length];
                const agentOrder = n % 8 === 0;
                seed.push(Order.create({
                    shop_id: shop.id,
                    order_number: `ORD-${String(100000 + counter)}`,
                    customer_id: (await customer).id,
                    customer_name: 'Rahima Begum',
                    customer_phone: '01812223344',
                    delivery_address: { street_address: 'House 12', upazila: 'Dhanmondi', district: 'Dhaka' },
                    total: 450 + (counter % 40) * 25,
                    delivery_charge: 60,
                    payment_method: payment_status === 'paid' ? 'bkash' : 'cod',
                    order_status, payment_status, fulfillment_status,
                    items: [{ name: 'Panjabi', quantity: 1 + (counter % 3), price: 450 }],
                    idempotency_key: agentOrder ? sha(`dryrun-agent-${shop.id}-${n}`) : null,
                    metadata: { source: agentOrder ? 'AI_SESSION' : 'MANUAL', dryrun: true },
                    channel: 'manual',
                }));
                counter += 1;
            }
        }
        await Promise.all(seed);
        // Spread created_at across 90 days in one bulk statement (no row loop).
        await sequelize.query("UPDATE orders SET created_at = NOW() - (random() * interval '90 days') WHERE (metadata ->> 'dryrun') = 'true'");

        // The cross-shop same-key case the partial unique index must ALLOW.
        const sharedKey = sha('dryrun-cross-shop-shared');
        await Order.create({
            shop_id: shops[0].shop.id, order_number: 'ORD-SHARED-A', customer_name: 'A',
            customer_phone: '01700000001', delivery_address: 'Mirpur', total: 100,
            order_status: 'confirmed', payment_status: 'pending', fulfillment_status: 'unfulfilled',
            items: [], idempotency_key: sharedKey, metadata: { dryrun: true },
        });
        await Order.create({
            shop_id: shops[1].shop.id, order_number: 'ORD-SHARED-B', customer_name: 'B',
            customer_phone: '01700000002', delivery_address: 'Gulshan', total: 200,
            order_status: 'confirmed', payment_status: 'pending', fulfillment_status: 'unfulfilled',
            items: [], idempotency_key: sharedKey, metadata: { dryrun: true },
        });

        const [ordersToday] = await sequelize.query('SELECT COUNT(*)::int AS count FROM orders');
        console.log(`   seeded orders in catalog: ${ordersToday[0].count}`);

        console.log('== 3/6 schema assertions: exactly one canonical index, within-shop duplicate refused, cross-shop legal');
        const [idemIdx] = await sequelize.query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname LIKE '%idempotency%'",
        );
        const idxNames = idemIdx.map((row) => row.indexname);
        if (idxNames.length !== 1 || idxNames[0] !== 'idx_orders_shop_idempotency') {
            throw new Error(`expected exactly the canonical idx_orders_shop_idempotency index, found: ${idxNames.join(', ') || '(none)'}`);
        }
        const [dispatchIdx] = await sequelize.query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'courier_dispatch' AND indexname = 'idx_courier_dispatch_shop_order'",
        );
        if (dispatchIdx.length !== 1) throw new Error('courier dispatch unique index missing after migrate');
        const [tagTables] = await sequelize.query(
            "SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name IN ('customer_notes','customer_tag_definitions','customer_tag_assignments')",
        );
        if (tagTables[0].c !== 3) throw new Error('MW-V1 notes/tags tables missing after migrate chain');

        const victim = await Order.findOne({ where: { order_number: 'ORD-SHARED-A' } });
        let refused = false;
        try {
            await sequelize.query(
                'INSERT INTO orders (id, shop_id, order_number, customer_name, customer_phone, delivery_address, total, order_status, payment_status, fulfillment_status, payment_method, channel, items, idempotency_key, created_at, updated_at) VALUES (:id, :shop, :num, :cn, :cp, :da, 99, :os, :ps, :fs, :pm, :ch, :items, :key, NOW(), NOW())',
                {
                    replacements: {
                        id: crypto.randomUUID(), shop: victim.shop_id, num: 'ORD-DUP-ATTEMPT',
                        cn: 'X', cp: '01700000009', da: JSON.stringify('Dup'), os: 'confirmed', ps: 'pending',
                        fs: 'unfulfilled', pm: 'cod', ch: 'manual', items: JSON.stringify([]), key: victim.idempotency_key,
                    },
                },
            );
        } catch (error) {
            refused = error.original?.code === '23505' || String(error.code) === '23505';
        }
        if (!refused) throw new Error('within-shop duplicate idempotency key was NOT refused by the index');

        console.log('== 4/6 duplicate-refusal scenario: legacy dirty data makes the migration fail LOUDLY');
        const [legacyIdx] = await sequelize.query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname LIKE '%idempotency%'",
        );
        for (const row of legacyIdx) await sequelize.query(`DROP INDEX IF EXISTS ${row.indexname}`);
        const dupKey = sha('dryrun-pre-existing-duplicate');
        const insertDup = async (num) => sequelize.query(
            'INSERT INTO orders (id, shop_id, order_number, customer_name, customer_phone, delivery_address, total, order_status, payment_status, fulfillment_status, payment_method, channel, items, idempotency_key, created_at, updated_at) VALUES (:id, :shop, :num, :cn, :cp, :da, 50, :os, :ps, :fs, :pm, :ch, :items, :key, NOW(), NOW())',
            {
                replacements: {
                    id: crypto.randomUUID(), shop: shops[2].shop.id, num, cn: 'Dup',
                    cp: '01700000008', da: JSON.stringify('Dhaka'), os: 'confirmed', ps: 'pending',
                    fs: 'unfulfilled', pm: 'cod', ch: 'manual', items: JSON.stringify([]), key: dupKey,
                },
            },
        );
        await insertDup('ORD-DUPE-1');
        await insertDup('ORD-DUPE-2');
        let loudRefusal = false;
        try {
            await migration.up(sequelize);
        } catch (error) {
            loudRefusal = /duplicated \(shop_id, idempotency_key\) rows exist/.test(error.message);
        }
        if (!loudRefusal) throw new Error('migration.up did not refuse pre-existing duplicates');

        console.log('== 5/6 reconcile (dedupe) then enforce: up recreates the canonical index and re-blocks duplicates');
        await sequelize.query(
            'DELETE FROM orders WHERE order_number = :num',
            { replacements: { num: 'ORD-DUPE-2' } },
        );
        await migration.up(sequelize);
        const [after] = await sequelize.query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_shop_idempotency'",
        );
        if (after.length !== 1) throw new Error('canonical index not restored after dedupe');
        const canonicalVictim = await Order.findOne({ where: { order_number: 'ORD-SHARED-A' } });
        let refusedAgain = false;
        try {
            await sequelize.query(
                'INSERT INTO orders (id, shop_id, order_number, customer_name, customer_phone, delivery_address, total, order_status, payment_status, fulfillment_status, payment_method, channel, items, idempotency_key, created_at, updated_at) VALUES (:id, :shop, :num, :cn, :cp, :da, 99, :os, :ps, :fs, :pm, :ch, :items, :key, NOW(), NOW())',
                {
                    replacements: {
                        id: crypto.randomUUID(), shop: canonicalVictim.shop_id, num: 'ORD-DUP-ATTEMPT-2',
                        cn: 'X', cp: '01700000009', da: JSON.stringify('Dup'), os: 'confirmed', ps: 'pending',
                        fs: 'unfulfilled', pm: 'cod', ch: 'manual', items: JSON.stringify([]), key: canonicalVictim.idempotency_key,
                    },
                },
            );
        } catch (error) {
            refusedAgain = error.original?.code === '23505' || String(error.code) === '23505';
        }
        if (!refusedAgain) throw new Error('recreated canonical index does not enforce duplicates');

        console.log('== 6/6 down/up round-trip: down only reverses this migration, up is idempotent');
        await migration.down(sequelize);
        const [stillCanonical] = await sequelize.query(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_shop_idempotency'",
        );
        if (stillCanonical.length !== 1) throw new Error('down must never drop the canonical June-owned index');
        await migration.up(sequelize);
        const [idempotent] = await sequelize.query(
            "SELECT COUNT(*)::int AS c FROM pg_indexes WHERE tablename = 'orders' AND indexname LIKE '%idempotency%'",
        );
        if (idempotent[0].c !== 1) throw new Error('up is not idempotent — index count drifted');

        await fx.cleanup();
        await sequelize.close();
        console.log('\nPROD-SHAPED-MIGRATION-DRYRUN: PASS');
    } catch (error) {
        failed = error;
        console.error('\nPROD-SHAPED-MIGRATION-DRYRUN: FAIL —', error.message);
        console.error('STACK:', String(error.stack).split('\n').slice(0, 8).join('\n'));
        console.error('CONSTRAINT:', error.original?.constraint || error.sql || 'n/a');
        if (error.errors) console.error('validation details:', error.errors.map((e) => `${e.path}: ${e.message}`).join(' | '));
        try { const { sequelize } = require('../src/utils/database/database-setup'); await sequelize.close(); } catch { /* already closed */ }
    } finally {
        if (servicesStarted) {
            run('docker', compose('down', '-v', '--remove-orphans'), composeEnv);
        }
    }
    process.exit(failed ? 1 : 0);
}

main();
