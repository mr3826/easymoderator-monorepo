/* eslint-disable no-console */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const capture = require('../lib/capture.js');

const {
  FIELDS,
  FIELD_LIMITS,
  DEFAULT_TTL_MS,
  GROWTH_ORIGINS,
  SOCIAL_HOSTS,
  extractPageData,
  extractEmailAddresses,
  extractPhoneNumbers,
  sanitizePayload,
  validatePayload,
  createPendingCaptureStore,
  isCapturableUrl,
  isSocialUrl,
  stripUrlCredentials,
  isGrowthUrl,
  buildCapturePageUrl,
  parseCapturePageUrl,
  isValidCaptureNonce,
  CAPTURE_NONCE_HEX_LENGTH
} = capture;

const TEST_NONCE = '0123456789abcdef0123456789abcdef';
const OTHER_NONCE = 'fedcba9876543210fedcba9876543210';

function fakeStorage() {
  const data = new Map();
  return {
    data,
    async get(key) {
      const shaped = {};
      if (typeof key === 'string' && data.has(key)) shaped[key] = data.get(key);
      return shaped;
    },
    async set(items) {
      for (const key of Object.keys(items)) data.set(key, items[key]);
    },
    async remove(key) {
      data.delete(key);
    }
  };
}

function fakeClock() {
  const clock = { now: 0 };
  return {
    clock,
    advance(ms) {
      clock.now += ms;
    },
    current() {
      return clock.now;
    }
  };
}

function validPayload() {
  return {
    businessName: 'Ravi Kebab House',
    pageUrl: 'https://listings.example.com/ravi-kebab-house',
    sourceWebsite: 'listings.example.com',
    selectedText: 'Open daily 11-23h',
    contactPhone: '+44 20 7946 0018',
    contactEmail: 'bookings@ravikebab.example',
    note: ''
  };
}

test('module is attached to globalThis for extension contexts', () => {
  assert.equal(globalThis.EasyModCapture, capture);
});

test('payload field names mirror CapturePage.tsx', () => {
  assert.deepEqual(
    [...FIELDS],
    ['businessName', 'pageUrl', 'sourceWebsite', 'selectedText', 'contactPhone', 'contactEmail', 'note']
  );
});

test('first-party growth origins only: production + local dev host', () => {
  assert.deepEqual([...GROWTH_ORIGINS].sort(), ['http://127.0.0.1:5175', 'https://growth.easymod.tech']);
  assert.equal(isGrowthUrl('https://growth.easymod.tech/capture'), true);
  assert.equal(isGrowthUrl('https://growth.easymod.tech.evil.example/x'), false);
  assert.equal(isGrowthUrl('http://127.0.0.1:5175/'), true);
  assert.equal(isGrowthUrl('http://127.0.0.2:5175/'), false);
});

test('extractPageData refuses chrome extension and growth host pages', () => {
  assert.equal(extractPageData({ title: 'Settings', url: 'chrome://extensions/' }), null);
  assert.equal(extractPageData({ title: 'x', url: 'chrome-extension://abcd/page.html' }), null);
  assert.equal(extractPageData({ title: 'x', url: 'file:///C:/notes/lead.html' }), null);
  assert.equal(extractPageData({ title: 'x', url: 'ftp://files.example.com' }), null);
  assert.equal(extractPageData({ title: 'x', url: 'https://growth.easymod.tech/capture' }), null);
  assert.equal(extractPageData({ title: 'x', url: 'http://127.0.0.1:5175/prospects' }), null);
  assert.equal(isCapturableUrl('chrome://settings'), false);
  assert.equal(isCapturableUrl('https://listings.example.com'), true);
});

test('manual capture refuses social-platform roots and subdomains but keeps ordinary public web pages', () => {
  assert.equal(SOCIAL_HOSTS.includes('facebook.com'), true);
  assert.equal(SOCIAL_HOSTS.includes('instagram.com'), true);
  assert.equal(SOCIAL_HOSTS.includes('messenger.com'), true);
  assert.equal(SOCIAL_HOSTS.includes('whatsapp.com'), true);

  for (const url of [
    'https://facebook.com/business-page',
    'https://business.facebook.com/page',
    'https://instagram.com/salon',
    'https://web.whatsapp.com/',
    'https://messenger.com/t/salon',
    'https://www.linkedin.com/company/salon',
    'https://x.com/salon'
  ]) {
    assert.equal(isSocialUrl(url), true, url);
    assert.equal(isCapturableUrl(url), false, url);
    assert.equal(extractPageData({ title: 'Social page', url }), null, url);
  }

  assert.equal(isSocialUrl('https://facebook.com.example/public-page'), false);
  assert.equal(isCapturableUrl('https://facebook.com.example/public-page'), true);
  assert.equal(isCapturableUrl('https://ordinary-business.example/listing'), true);
});

test('extractPageData builds all seven fields and enforces limits', () => {
  const data = extractPageData({
    title: 'RAVI KEBAB HOUSE — Halal grill & buffet on ' + 'x'.repeat(300),
    url: 'https://listings.example.com/ravi?' + 'q'.repeat(2100),
    selection: 'menu and more '.repeat(1000),
    links: ['mailto:BOOKINGS@RaviKebab.example?subject=Hi', 'tel:+44 20 7946 0018', 'https://listings.example.com/prices'],
    visibleText: 'Call 020 7946 0099 or visit second@example.com'
  });

  assert.equal(Object.keys(data).sort().join(','), [...FIELDS].sort().join(','));
  assert.equal(data.businessName.length, FIELD_LIMITS.businessName);
  assert.equal(data.pageUrl.length, FIELD_LIMITS.pageUrl);
  assert.equal(data.selectedText.length, FIELD_LIMITS.selectedText);
  assert.equal(data.sourceWebsite, 'listings.example.com');
  assert.equal(data.contactEmail, 'bookings@ravikebab.example');
  assert.equal(data.contactPhone, '+44 20 7946 0018');
});

test('extractPageData trims and reads nothing unsafe (no cookies/storage)', () => {
  const data = extractPageData({
    title: '  Marina Beauty Salon  ',
    url: 'https://salons.example/marina',
    selection: 'gel nails',
    links: [
      { href: 'mailto:info@salons.example' },
      { href: 'tel:+1-555-0100' }
    ],
    visibleText: 'Marina Beauty Salon at 42 High St'
  });
  assert.equal(data.businessName, 'Marina Beauty Salon');
  assert.equal(data.sourceWebsite, 'salons.example');
  assert.deepEqual(data.contactPhone, '+1-555-0100');
  assert.deepEqual(data.contactEmail, 'info@salons.example');
});

test('strips URL username and password before page URLs enter the payload', () => {
  const sourceUrl = 'https://operator:super-secret@listings.example/ravi?source=public';
  assert.equal(
    stripUrlCredentials(sourceUrl),
    'https://listings.example/ravi?source=public'
  );
  assert.equal(
    extractPageData({ title: 'Ravi Kebab House', url: sourceUrl }).pageUrl,
    'https://listings.example/ravi?source=public'
  );
  assert.equal(
    sanitizePayload({ businessName: 'Ravi Kebab House', pageUrl: sourceUrl }).pageUrl,
    'https://listings.example/ravi?source=public'
  );
});

test('sanitizePayload drops unknown keys, truncates long fields, coerces non-strings', () => {
  const clean = sanitizePayload({
    businessName: 'Y'.repeat(400),
    pageUrl: 'https://a.example/'.padEnd(3000, 'p'),
    contactPhone: 12345,
    contactEmail: null,
    note: 'keep me',
    cookies: 'session=super-secret',
    localStorage: { token: 'jwt' }
  });
  assert.equal(Object.keys(clean).every((key) => FIELDS.includes(key)), true);
  assert.equal('cookies' in clean, false);
  assert.equal(clean.businessName.length, FIELD_LIMITS.businessName);
  assert.equal(clean.pageUrl.length, FIELD_LIMITS.pageUrl);
  assert.equal(clean.contactPhone, '');
  assert.equal(clean.contactEmail, '');
  assert.equal(clean.note, 'keep me');
});

test('validatePayload enforces shape, limits and required name', () => {
  assert.deepEqual(validatePayload(validPayload()), { ok: true, errors: [] });

  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload('not-an-object').ok, false);
  assert.equal(validatePayload([]).ok, false);

  const withUnknown = validatePayload({ ...validPayload(), cookieJar: 'no' });
  assert.equal(withUnknown.ok, false);
  assert.match(withUnknown.errors.join(' '), /unknown field/);

  const tooLong = validatePayload({ ...validPayload(), note: 'n'.repeat(FIELD_LIMITS.note + 1) });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors.join(' '), /note exceeds/);

  const nonString = validatePayload({ ...validPayload(), businessName: 42 });
  assert.equal(nonString.ok, false);

  const blankName = validatePayload({ ...validPayload(), businessName: '   ' });
  assert.equal(blankName.ok, false);
  assert.match(blankName.errors.join(' '), /businessName is required/);
});

test('contact candidates: email from cookies/links only, capped to first 3', () => {
  const links = [
    'tel:+44 20 7946 0018',
    'mailto:first@example.com',
    'tel:+31 20 123 4567',
    'malto:not-an-email@evil.example',
    'https://example.com/second@example.com'
  ];
  const visibleText = 'Contact: third@example.com or fourth@example.com or fifth@example.com';
  const emails = extractEmailAddresses({ links, visibleText });
  const phones = extractPhoneNumbers({ links });
  assert.deepEqual(emails, ['first@example.com', 'third@example.com', 'fourth@example.com']);
  assert.equal(emails.length, capture.MAX_CONTACT_CANDIDATES);
  assert.deepEqual(phones, ['+44 20 7946 0018', '+31 20 123 4567']);
});

test('visible-text email regex is conservative', () => {
  const emails = extractEmailAddresses({
    visibleText: 'not an @ email @@nope no.at.Sign.example.com real@example.com but not user@example'
  });
  assert.deepEqual(emails, ['real@example.com']);
});

test('pending store: put validates, claim delivers exactly once', async () => {
  const storage = fakeStorage();
  const store = createPendingCaptureStore(storage, { now: () => Date.now() });

  await store.put(validPayload(), TEST_NONCE);
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), true);

  const claimed = await store.claim(TEST_NONCE);
  assert.deepEqual(claimed, sanitizePayload(validPayload()));
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), false);

  const second = await store.claim(TEST_NONCE);
  assert.equal(second, null);
});

test('pending store: TTL expires old payloads (fake clock + fake storage)', async () => {
  const storage = fakeStorage();
  const { advance, current } = fakeClock();
  const store = createPendingCaptureStore(storage, { now: () => current(), ttlMs: DEFAULT_TTL_MS });

  await store.put(validPayload(), TEST_NONCE);
  advance(DEFAULT_TTL_MS - 1);
  const fresh = await store.claim(TEST_NONCE);
  assert.deepEqual(fresh, sanitizePayload(validPayload()));

  await store.put(validPayload(), OTHER_NONCE);
  advance(DEFAULT_TTL_MS + 1);
  const stale = await store.claim(OTHER_NONCE);
  assert.equal(stale, null);
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), false);
});

test('pending store: put rejects invalid payload, claim rejects garbage entry', async () => {
  const storage = fakeStorage();
  const store = createPendingCaptureStore(storage, {
    now: () => Date.now(),
    ttlMs: DEFAULT_TTL_MS,
    key: 'pendingCapturePayloadV1'
  });

  await assert.rejects(() => store.put({ note: 'no name' }), /invalid capture payload/);
  await assert.rejects(() => store.put(validPayload()), /invalid capture nonce/);
  assert.equal(storage.data.has(store.key), false);

  const shaped = {};
  shaped[store.key] = {
    nonce: TEST_NONCE,
    createdAt: Date.now(),
    payload: { businessName: 'ok', evil: 'yes' }
  };
  await storage.set(shaped);
  assert.equal(await store.claim(TEST_NONCE), null);
  assert.equal(storage.data.has(store.key), false);

  await storage.set({ [store.key]: 'not-an-entry' });
  assert.equal(await store.claim(TEST_NONCE), null);
  assert.equal(storage.data.has(store.key), false);
});

test('pending store: concurrent matching claims deliver exactly one payload', async () => {
  const storage = fakeStorage();
  const store = createPendingCaptureStore(storage, { now: () => Date.now() });

  await store.put(validPayload(), TEST_NONCE);
  const results = await Promise.all([
    store.claim(TEST_NONCE),
    store.claim(TEST_NONCE)
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.filter((value) => value === null).length, 1);
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), false);
});

test('pending store: nonce mismatch does not consume the pending payload', async () => {
  const storage = fakeStorage();
  const store = createPendingCaptureStore(storage, { now: () => Date.now() });

  await store.put(validPayload(), TEST_NONCE);
  assert.equal(await store.claim(OTHER_NONCE), null);
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), true);
  assert.deepEqual(await store.claim(TEST_NONCE), sanitizePayload(validPayload()));
});

test('pending store: target tab binding rejects unrelated tabs', async () => {
  const storage = fakeStorage();
  const store = createPendingCaptureStore(storage, { now: () => Date.now() });

  await store.put(validPayload(), {
    nonce: TEST_NONCE,
    targetOrigin: 'https://growth.easymod.tech',
    targetPath: '/capture'
  });
  assert.equal(await store.bindTargetTab({
    nonce: TEST_NONCE,
    targetTabId: 17,
    targetOrigin: 'https://growth.easymod.tech',
    targetPath: '/capture'
  }), true);
  assert.equal(await store.claim({
    nonce: TEST_NONCE,
    targetTabId: 17,
    targetOrigin: 'http://127.0.0.1:5175',
    targetPath: '/capture'
  }), null);
  assert.equal(await store.claim({
    nonce: TEST_NONCE,
    targetTabId: 18,
    targetOrigin: 'https://growth.easymod.tech',
    targetPath: '/capture'
  }), null);
  assert.equal(storage.data.has(capture.PENDING_CAPTURE_KEY), true);
  assert.deepEqual(
    await store.claim({
      nonce: TEST_NONCE,
      targetTabId: 17,
      targetOrigin: 'https://growth.easymod.tech',
      targetPath: '/capture'
    }),
    sanitizePayload(validPayload())
  );
});

test('capture page URL requires an exact first-party path and nonce-only query', () => {
  const url = buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE);
  assert.equal(url, 'https://growth.easymod.tech/capture?captureNonce=' + TEST_NONCE);
  assert.deepEqual(parseCapturePageUrl(url), {
    origin: 'https://growth.easymod.tech',
    pathname: '/capture',
    nonce: TEST_NONCE
  });
  assert.equal(isValidCaptureNonce(TEST_NONCE), true);
  assert.equal(TEST_NONCE.length, CAPTURE_NONCE_HEX_LENGTH);
  assert.equal(parseCapturePageUrl('https://growth.easymod.tech/prospects?captureNonce=' + TEST_NONCE), null);
  assert.equal(parseCapturePageUrl('https://evil.example/capture?captureNonce=' + TEST_NONCE), null);
  assert.equal(parseCapturePageUrl('https://growth.easymod.tech/capture'), null);
  assert.equal(
    parseCapturePageUrl('https://growth.easymod.tech/capture?captureNonce=' + TEST_NONCE + '&extra=nope'),
    null
  );
  assert.equal(parseCapturePageUrl('https://growth.easymod.tech/capture?captureNonce=not-a-nonce'), null);
});

test('buildCapturePageUrl uses first-party origins only and never includes PII', () => {
  assert.equal(
    buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE),
    'https://growth.easymod.tech/capture?captureNonce=' + TEST_NONCE
  );
  assert.equal(
    buildCapturePageUrl('http://127.0.0.1:5175', OTHER_NONCE),
    'http://127.0.0.1:5175/capture?captureNonce=' + OTHER_NONCE
  );
  assert.throws(() => buildCapturePageUrl('https://evil.example'), /first-party/);
  assert.throws(() => buildCapturePageUrl('https://growth.easymod.tech', 'businessName=Ravi'), /nonce/);
});
