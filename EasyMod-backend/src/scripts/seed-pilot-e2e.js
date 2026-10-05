'use strict';

/**
 * Deterministic fixtures for the pilot intelligence (Customer 360 + Sales
 * Opportunities + RTO Shield v2) REAL-STACK browser E2E.
 *
 * Modeled on seed-growth-e2e.js: connects through src/database, seeds one
 * shop with the pilot flags on, an owner + a staff member, customers,
 * conversations, orders and one sales opportunity, then prints the seeded
 * identifiers as JSON and writes a fixture file the Playwright spec reads.
 *
 * Flag mechanism (real, from PR #196): shop_pilot_features row keyed by
 * shop_id — customer_intelligence: true, order_confidence_mode: 'enforce'.
 * A courier integration (steadfast, dummy credentials) is seeded so the
 * booking gate is reached BEFORE any courier API would be called; the live
 * tier asserts the 409 hold and the cleared UI, never a real booking.
 */

const args = new Set(process.argv.slice(2));
const { assertDisposableDatabase } = require('../../tests/helpers/disposable-database');
assertDisposableDatabase(process.env.DATABASE_URL, 'the pilot intelligence browser E2E seed');

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('../utils/database/database-setup');
const {
  AuditLog,
  Conversation,
  Customer,
  CustomerOpportunity,
  DeliveryIntegration,
  DeliveryTracking,
  Message,
  MetaChannel,
  Order,
  OrderConfidence,
  Shop,
  ShopPickupLocation,
  ShopPilotFeatures,
  Tenant,
  User,
  UserShop,
} = require('../modules/entities');
const { hashPassword } = require('../utils/password.util');

const repoRoot = path.resolve(__dirname, '../../..');
const fixturePath = path.join(repoRoot, 'EasyMod-frontend', 'tests', 'e2e', '.pilot-fixtures.json');
const password = process.env.PILOT_E2E_PASSWORD || 'PilotE2E-Password-2026!';
const tenantName = 'Pilot E2E tenant';
const shopCode = 'PILOT-E2E-01';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

async function ensureTenantAndShop() {
  const [tenant] = await Tenant.findOrCreate({
    where: { name: tenantName },
    defaults: { name: tenantName, is_active: true, settings: { fixture: 'pilot-e2e' } },
  });
  await tenant.update({ is_active: true, settings: { fixture: 'pilot-e2e' } });

  const [shop] = await Shop.findOrCreate({
    where: { unique_code: shopCode },
    defaults: {
      unique_code: shopCode,
      tenant_id: tenant.id,
      shop_name: 'Pilot E2E Shop',
      name: 'Pilot E2E Shop',
      is_active: true,
      timezone: 'Asia/Dhaka',
      settings: { fixture: 'pilot-e2e', onboarding_completed: true },
    },
  });
  await shop.update({
    tenant_id: tenant.id,
    shop_name: 'Pilot E2E Shop',
    name: 'Pilot E2E Shop',
    is_active: true,
    timezone: 'Asia/Dhaka',
    settings: { fixture: 'pilot-e2e', onboarding_completed: true },
  });

  // The real pilot gate: platform-controlled per-shop flags.
  await ShopPilotFeatures.destroy({ where: { shop_id: shop.id } });
  await ShopPilotFeatures.create({
    shop_id: shop.id,
    customer_intelligence: true,
    order_confidence_mode: 'enforce',
    order_confidence_config: {}, // defaults: cod threshold 10000, min address length 15
    updated_by: null,
  });
  return { tenant, shop };
}

async function ensureUser({ email, fullName, phone, shopRole }, passwordHash, shop) {
  const [user] = await User.findOrCreate({
    where: { email },
    defaults: {
      email,
      password: passwordHash,
      full_name: fullName,
      phone,
      token_version: 0,
      settings: {},
      last_logged_shop_id: shop.id,
    },
  });
  await user.update({
    password: passwordHash,
    full_name: fullName,
    phone,
    token_version: 0,
    refresh_token: null,
    settings: {},
    last_logged_shop_id: shop.id,
  });

  const [membership] = await UserShop.findOrCreate({
    where: { user_id: user.id, shop_id: shop.id },
    defaults: { user_id: user.id, shop_id: shop.id, role: shopRole, is_active: true },
  });
  await membership.update({ role: shopRole, is_active: true });
  return user;
}

async function ensurePage(shop) {
  const [page] = await MetaChannel.findOrCreate({
    where: { shop_id: shop.id, meta_asset_id: 'pilot-e2e-page-1' },
    defaults: {
      shop_id: shop.id,
      platform: 'facebook',
      meta_asset_id: 'pilot-e2e-page-1',
      display_name: 'Pilot E2E Page',
    },
  });
  await page.update({ display_name: 'Pilot E2E Page', platform: 'facebook' });
  return page;
}

/** Remove previous disposable-run fixtures so the seed is idempotent. */
async function resetFixtures(shop) {
  const customers = await Customer.findAll({
    where: { shop_id: shop.id },
    attributes: ['id'],
  });
  const customerIds = customers.map((c) => c.id);
  const orders = await Order.findAll({ where: { shop_id: shop.id }, attributes: ['id'] });
  const orderIds = orders.map((o) => o.id);

  await OrderConfidence.destroy({ where: { shop_id: shop.id } });
  await CustomerOpportunity.destroy({ where: { shop_id: shop.id } });
  if (orderIds.length) {
    await DeliveryTracking.destroy({ where: { order_id: { [Op.in]: orderIds } } }).catch(() => {});
    await Order.destroy({ where: { id: { [Op.in]: orderIds } } });
  }
  const conversations = await Conversation.findAll({ where: { shop_id: shop.id }, attributes: ['id'] });
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length) {
    await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } } });
    await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } } });
  }
  if (customerIds.length) {
    await Customer.destroy({ where: { id: { [Op.in]: customerIds } } });
  }
  await DeliveryIntegration.destroy({ where: { shop_id: shop.id } });
  await ShopPickupLocation.destroy({ where: { shop_id: shop.id } });
}

function createCustomer(shop, page, { name, phone, channelUserId, consentFreshMs }) {
  return Customer.create({
    shop_id: shop.id,
    name,
    phone: phone || null,
    channel_type: 'messenger',
    channel_user_id: channelUserId,
    meta_channel_id: page.id,
    messaging_consent: {
      facebook: {
        opted_in: true,
        opted_out_at: null,
        // A recent inbound keeps the 24h reply window open.
        last_inbound_at: ago(consentFreshMs),
      },
    },
    metadata: { fixture: 'pilot-e2e' },
    last_active: ago(consentFreshMs),
  });
}

function orderFixture(shop, fields) {
  return {
    shop_id: shop.id,
    channel: 'messenger',
    items: [{ product_id: 'pilot-product-panjabi', product_name: 'Black Panjabi', name: 'Black Panjabi', quantity: 1, price: Number(fields.total) }],
    payment_status: 'pending',
    payment_method: 'cash_on_delivery',
    delivery_zone: 'inside_dhaka',
    ...fields,
  };
}

async function main() {
  const { shop } = await ensureTenantAndShop();
  const owner = await ensureUser({
    email: 'owner@pilot-test.bd',
    fullName: 'Pilot E2E Owner',
    phone: '01900000001',
    shopRole: 'owner',
  }, await hashPassword(password), shop);
  const staff = await ensureUser({
    email: 'staff@pilot-test.bd',
    fullName: 'Pilot E2E Staff',
    phone: '01900000002',
    shopRole: 'staff',
  }, await hashPassword(password), shop);
  const page = await ensurePage(shop);
  await resetFixtures(shop);

  // ── Customers ──────────────────────────────────────────────────────────
  const repeatBuyer = await createCustomer(shop, page, {
    name: 'Rahim Uddin', phone: '01711111111', channelUserId: 'psid-rahim', consentFreshMs: HOUR,
  });
  const interested = await createCustomer(shop, page, {
    name: 'Karim Hasan', phone: null, channelUserId: 'psid-karim', consentFreshMs: 2 * HOUR,
  });
  const newcomer = await createCustomer(shop, page, {
    name: 'Tania Akter', phone: null, channelUserId: 'psid-tania', consentFreshMs: 3 * HOUR,
  });
  const repeatReturner = await createCustomer(shop, page, {
    name: 'Jamal Hossain', phone: '01822222222', channelUserId: 'psid-jamal', consentFreshMs: 4 * HOUR,
  });

  // ── Order history (drives REPEAT_BUYER / REPEATED_RETURNS derivation) ──
  const deliveredOne = await Order.create(orderFixture(shop, {
    order_number: 'ORD-100', customer_id: repeatBuyer.id,
    customer_name: 'Rahim Uddin', customer_phone: '01711111111',
    order_status: 'completed', delivery_status: 'delivered',
    delivery_provider: 'pathao', delivery_tracking_code: 'TRK-100',
    delivery_consignment_id: 'CN-100', delivered_at: ago(3 * DAY),
    total: 1000, delivery_address: 'House 1, Road 2, Banani, Dhaka 1213',
    createdAt: ago(10 * DAY), updatedAt: ago(3 * DAY),
  }));
  const deliveredTwo = await Order.create(orderFixture(shop, {
    order_number: 'ORD-101', customer_id: repeatBuyer.id,
    customer_name: 'Rahim Uddin', customer_phone: '01711111111',
    order_status: 'completed', delivery_status: 'delivered',
    delivery_provider: 'pathao', delivery_tracking_code: 'TRK-101',
    delivery_consignment_id: 'CN-101', delivered_at: ago(3 * DAY),
    total: 2000, delivery_address: 'House 1, Road 2, Banani, Dhaka 1213',
    createdAt: ago(5 * DAY), updatedAt: ago(3 * DAY),
  }));
  // Not linked by customer_id — associated at read time by phone (PHONE_MATCH).
  const cancelledOrder = await Order.create(orderFixture(shop, {
    order_number: 'ORD-099', customer_id: null,
    customer_name: 'Rahim Uddin', customer_phone: '01711111111',
    order_status: 'cancelled', total: 500,
    delivery_address: 'House 1, Road 2, Banani, Dhaka 1213',
    createdAt: ago(20 * DAY), updatedAt: ago(20 * DAY),
  }));
  // Repeat returns for Jamal: 2 returned, 0 delivered -> REPEATED_RETURNS.
  const returnedOne = await Order.create(orderFixture(shop, {
    order_number: 'ORD-090', customer_id: repeatReturner.id,
    customer_name: 'Jamal Hossain', customer_phone: '01822222222',
    order_status: 'completed', delivery_status: 'returned',
    delivery_provider: 'steadfast', delivery_tracking_code: 'TRK-090',
    delivery_consignment_id: 'CN-090',
    total: 1400, delivery_address: 'Flat 4B, Block C, Bashundhara R/A, Dhaka 1229',
    createdAt: ago(12 * DAY), updatedAt: ago(11 * DAY),
  }));
  const returnedTwo = await Order.create(orderFixture(shop, {
    order_number: 'ORD-091', customer_id: repeatReturner.id,
    customer_name: 'Jamal Hossain', customer_phone: '01822222222',
    order_status: 'completed', delivery_status: 'returned',
    delivery_provider: 'steadfast', delivery_tracking_code: 'TRK-091',
    delivery_consignment_id: 'CN-091',
    total: 900, delivery_address: 'Flat 4B, Block C, Bashundhara R/A, Dhaka 1229',
    createdAt: ago(8 * DAY), updatedAt: ago(7 * DAY),
  }));

  // ── Live orders under the pilot gate (all inside the last-7-days view) ──
  const readyOrder = await Order.create(orderFixture(shop, {
    order_number: 'ORD-300', customer_id: null, // keep Tania Akter order-less: NEW state
    customer_name: 'Nusrat Jahan', customer_phone: '01833333333',
    order_status: 'confirmed',
    total: 1500, delivery_address: 'House 12, Road 5, Dhanmondi, Dhaka 1205',
    createdAt: ago(1 * HOUR), updatedAt: ago(1 * HOUR),
  }));
  // ADDRESS_TOO_SHORT: 'mirpur 10' normalizes to 9 characters (< 15).
  const verifyOrder = await Order.create(orderFixture(shop, {
    order_number: 'ORD-301',
    customer_name: 'Salma Akter', customer_phone: '01844444444',
    order_status: 'confirmed',
    total: 1500, delivery_address: 'Mirpur 10',
    createdAt: ago(2 * HOUR), updatedAt: ago(2 * HOUR),
  }));
  const reviewOrder = await Order.create(orderFixture(shop, {
    order_number: 'ORD-302', customer_id: repeatReturner.id,
    customer_name: 'Jamal Hossain', customer_phone: '01822222222',
    order_status: 'confirmed',
    total: 1200, delivery_address: 'Flat 4B, Block C, Bashundhara R/A, Dhaka 1229',
    createdAt: ago(30 * MINUTE), updatedAt: ago(30 * MINUTE),
  }));

  // ── Conversation with buying intent for the INTERESTED customer ────────
  const conversation = await Conversation.create({
    shop_id: shop.id,
    customer_id: interested.id,
    meta_channel_id: page.id,
    channel: 'messenger',
    title: 'Karim Hasan',
    status: 'active',
    role: 'user',
    message: 'Black Panjabi ta ase? ami order korte chai. delivery charge koto?',
    createdAt: ago(2 * HOUR),
    updatedAt: ago(1 * HOUR),
  });
  await Message.create({
    conversation_id: conversation.id,
    sender: 'customer',
    content: 'Black Panjabi ta ase? ami order korte chai. delivery charge koto?',
    external_id: 'pilot-e2e-msg-1',
    created_at: ago(1 * HOUR),
  });

  // Seeded directly (the detector sweep is an embedded worker, kept off in
  // the live E2E stack): one OPEN opportunity, HIGH strength.
  const opportunity = await CustomerOpportunity.create({
    shop_id: shop.id,
    customer_id: interested.id,
    conversation_id: conversation.id,
    status: 'OPEN',
    strength: 'HIGH',
    reasons: ['PURCHASE_INTENT', 'ASKED_DELIVERY_CHARGE'],
    signals: [{ code: 'PURCHASE_INTENT', source: 'MESSAGE', message_id: 'pilot-e2e-msg-1', at: ago(1 * HOUR) }],
    product_refs: [{ product_id: 'pilot-product-panjabi', name: 'Black Panjabi', quantity: 1 }],
    first_signal_at: ago(2 * HOUR),
    last_signal_at: ago(1 * HOUR),
    detected_at: ago(30 * MINUTE),
    detector_version: 'pilot-e2e-seed/1.0.0',
  });
  await AuditLog.create({
    user_id: owner.id,
    shop_id: shop.id,
    action: 'OPPORTUNITY_SEEDED',
    resource_type: 'CUSTOMER_OPPORTUNITY',
    resource_id: opportunity.id,
    old_values: null,
    new_values: { status: opportunity.status },
    metadata: { source: 'pilot-e2e-seed' },
    ip_address: '127.0.0.1',
    user_agent: 'pilot-e2e-seed',
  }).catch(() => {});

  // A "ready" steadfast integration with dummy credentials: the booking gate
  // runs before any courier API call, so held orders still return the real
  // 409 ORDER_CONFIDENCE_HOLD without external traffic.
  const pickup = await ShopPickupLocation.create({
    shop_id: shop.id,
    display_name: 'Pilot E2E Pickup',
    address: 'House 12, Road 5, Dhanmondi, Dhaka 1205',
    area_name: 'Dhanmondi',
    city_name: 'Dhaka',
    zone_name: 'Dhaka',
    provider: 'steadfast',
    provider_store_id: 'pilot-e2e-store-1',
    is_active: true,
    is_default: true,
  });
  await DeliveryIntegration.create({
    shop_id: shop.id,
    provider: 'steadfast',
    credentials: { api_key: 'pilot-e2e-api-key', secret_key: 'pilot-e2e-secret-key' },
    is_active: true,
    is_connected: true,
    is_sandbox: true,
    pickup_location_id: pickup.id,
    provider_store_id: 'pilot-e2e-store-1',
    pickup_enabled: true,
    is_ai_default: true,
    activation_status: 'ACTIVE',
  });

  const fixture = {
    version: 1,
    password,
    shop: { id: shop.id, name: shop.name, shopName: shop.shop_name, uniqueCode: shop.unique_code },
    page: { id: page.id, name: page.display_name },
    users: {
      owner: { id: owner.id, email: owner.email, role: 'owner' },
      staff: { id: staff.id, email: staff.email, role: 'staff' },
    },
    customers: {
      repeatBuyer: { id: repeatBuyer.id, name: repeatBuyer.name, phone: repeatBuyer.phone, state: 'REPEAT_BUYER' },
      interested: { id: interested.id, name: interested.name, state: 'INTERESTED' },
      newcomer: { id: newcomer.id, name: newcomer.name, state: 'NEW' },
      repeatReturner: { id: repeatReturner.id, name: repeatReturner.name, phone: repeatReturner.phone, state: 'AT_RISK' },
    },
    orders: {
      ready: { id: readyOrder.id, number: 'ORD-300', expectedDecision: 'READY' },
      verify: { id: verifyOrder.id, number: 'ORD-301', expectedDecision: 'VERIFY', holdReason: 'ADDRESS_TOO_SHORT' },
      manualReview: { id: reviewOrder.id, number: 'ORD-302', expectedDecision: 'MANUAL_REVIEW', holdReason: 'REPEATED_RETURNS' },
      history: {
        deliveredOne: { id: deliveredOne.id, number: 'ORD-100' },
        deliveredTwo: { id: deliveredTwo.id, number: 'ORD-101' },
        cancelled: { id: cancelledOrder.id, number: 'ORD-099' },
        returnedOne: { id: returnedOne.id, number: 'ORD-090' },
        returnedTwo: { id: returnedTwo.id, number: 'ORD-091' },
      },
    },
    opportunity: { id: opportunity.id, status: 'OPEN', conversation_id: conversation.id, productName: 'Black Panjabi' },
    conversation: { id: conversation.id, customer_id: interested.id },
  };
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  console.log(`Pilot browser E2E fixtures written to ${path.relative(repoRoot, fixturePath)}`);
  console.log(`Pilot E2E owner login: ${owner.email} / ${process.env.PILOT_E2E_PASSWORD ? '(env password)' : password}`);
  console.log(JSON.stringify({ shop: fixture.shop, users: fixture.users }));
  console.log(JSON.stringify({ customers: fixture.customers }));
  console.log(JSON.stringify({ orders: fixture.orders, opportunity: fixture.opportunity }));
  if (args.has('--print')) console.log(JSON.stringify(fixture, null, 2));
}

main()
  .catch((error) => {
    console.error(`Pilot browser E2E seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
