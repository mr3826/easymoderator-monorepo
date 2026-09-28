'use strict';

/**
 * Pilot intelligence security boundaries (docs/pilot-intelligence/06-security-and-privacy.md).
 *
 * 1. No new outbound path (ADR-0008): Customer 360, Sales Opportunities,
 *    Order Confidence and the detector job never import a Meta send,
 *    provider, webhook-send or policy-bypass module. Follow-up is manual,
 *    through the Inbox, under the central policy engine.
 * 2. Tenant from the token: controllers never read shop_id from the body,
 *    query or headers.
 * 3. The booking boundary: the gate sits inside bookForOrder before the
 *    durable dispatch claim, and no pilot module calls the courier provider.
 */

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '../../..');
const src = (...parts) => path.join(backendRoot, 'src', ...parts);

const collect = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : collect(full);
    return entry.name.endsWith('.js') ? [full] : [];
});

const pilotFiles = [
    ...collect(src('modules', 'customer-intelligence')),
    ...collect(src('modules', 'order-confidence')),
    ...collect(src('modules', 'pilot-features')),
    src('jobs', 'opportunity-detector.job.js'),
];
const rel = (file) => path.relative(backendRoot, file).replace(/\\/g, '/');

describe('pilot intelligence boundaries', () => {
    test('covers every pilot module', () => {
        expect(pilotFiles.length).toBeGreaterThanOrEqual(18);
    });

    test('no pilot module can reach a Meta or courier send path', () => {
        // Imports of send/provider modules, and call sites of send functions.
        const forbidden = [
            /require\(['"][^'"]*meta-send[^'"]*['"]\)/,
            /require\(['"][^'"]*channel-providers\/[^'"]*[Pp]rovider[^'"]*['"]\)/,
            /require\(['"][^'"]*webhook\/webhook\.service['"]\)/,
            /require\(['"][^'"]*delivery\/providers\/[^'"]*['"]\)/,
            /require\(['"][^'"]*delivery\/delivery\.service['"]\)/,
            /\bsendToCustomer\s*\(/,
            /_deliverViaMeta\w*\s*\(/,
            /\bcreateDeliveryOrder\s*\(/,
            /\bsendMessage\s*\(/,
            /graph\.facebook\.com/,
        ];
        const violations = [];
        for (const file of pilotFiles) {
            const source = fs.readFileSync(file, 'utf8');
            for (const pattern of forbidden) {
                if (pattern.test(source)) violations.push(`${rel(file)} matches ${pattern}`);
            }
        }
        expect(violations).toEqual([]);
    });

    test('pilot controllers take the tenant only from the verified token', () => {
        for (const file of pilotFiles.filter((f) => f.endsWith('.controller.js'))) {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).toMatch(/req\.user\.shopId/);
            expect(source).not.toMatch(/req\.(body|query|params|headers)\.(shop_id|shopId)/);
            expect(source).not.toMatch(/x-shop-id/i);
        }
    });

    test('every pilot router authenticates and verifies shop membership first', () => {
        for (const file of pilotFiles.filter((f) => f.endsWith('.routes.js'))) {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).toMatch(/router\.use\(authenticate, verifyShopAccess\)/);
        }
    });

    test('MANUAL_REVIEW approval is owner/admin-guarded at the route and re-checked in the service', () => {
        const routes = fs.readFileSync(src('modules', 'order-confidence', 'order-confidence.routes.js'), 'utf8');
        expect(routes).toMatch(/'\/orders\/:orderId\/approve', requireOwnerOrAdmin/);
        const service = fs.readFileSync(src('modules', 'order-confidence', 'order-confidence.service.js'), 'utf8');
        expect(service).toMatch(/kind === 'APPROVED' && !OWNER_OR_ADMIN\.has\(role\)/);
    });

    test('the confidence gate runs inside bookForOrder before the durable dispatch claim', () => {
        const source = fs.readFileSync(src('modules', 'order', 'order.service.js'), 'utf8');
        const body = source.slice(source.indexOf('const bookForOrder = async'));
        const gateAt = body.indexOf('checkBookingGate(');
        const claimAt = body.indexOf('claimCourierDispatchRecord(order, shopId');
        const providerAt = body.indexOf('deliveryService.createDeliveryOrder(');
        expect(gateAt).toBeGreaterThan(0);
        expect(gateAt).toBeLessThan(claimAt);
        expect(claimAt).toBeLessThan(providerAt);
    });

    test('pilot flags are not stored in merchant-writable shop settings', () => {
        const validator = fs.readFileSync(src('modules', 'shop', 'shop-settings.validator.js'), 'utf8');
        expect(validator).not.toMatch(/pilot_features/);
        for (const file of pilotFiles) {
            expect(fs.readFileSync(file, 'utf8')).not.toMatch(/settings\.pilot_features|settings\?\.pilot_features/);
        }
    });

    test('opportunity signals and confidence reasons never persist raw message text or contact details', () => {
        const signals = fs.readFileSync(src('modules', 'customer-intelligence', 'opportunity-signals.js'), 'utf8');
        expect(signals).not.toMatch(/content:\s*message/);
        expect(signals).not.toMatch(/text:\s*text/);
        const rules = fs.readFileSync(src('modules', 'order-confidence', 'order-confidence.rules.js'), 'utf8');
        expect(rules).not.toMatch(/evidence[^;]*customer_phone/);
        expect(rules).not.toMatch(/evidence[^;]*delivery_address\s*[,}]/);
    });
});
