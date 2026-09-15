'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const capture = require('../lib/capture.js');

const extensionRoot = path.join(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(extensionRoot, 'content-bridge.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8');
const captureSource = fs.readFileSync(path.join(extensionRoot, 'lib', 'capture.js'), 'utf8');
const TEST_NONCE = '0123456789abcdef0123456789abcdef';

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

function pendingEntry(targetTabId) {
  const entry = {
    nonce: TEST_NONCE,
    payload: validPayload(),
    createdAt: Date.now()
  };
  if (targetTabId !== undefined) entry.targetTabId = targetTabId;
  return entry;
}

function claimMessage(url) {
  const target = capture.parseCapturePageUrl(url);
  return {
    type: capture.CLAIM_MESSAGE_TYPE,
    nonce: target.nonce,
    targetOrigin: target.origin,
    targetPath: target.pathname
  };
}

function sender(url, tabId, frameId) {
  return {
    id: 'extension-id',
    frameId: frameId === undefined ? 0 : frameId,
    tab: { id: tabId === undefined ? 7 : tabId, url: url }
  };
}

function runBridge(url, responsePayload) {
  const parsedUrl = new URL(url);
  const sessionData = new Map();
  const messages = [];
  const posted = [];
  const windowObject = {
    top: null,
    location: {
      href: parsedUrl.href,
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname
    },
    sessionStorage: {
      removeItem(key) {
        sessionData.delete(key);
      },
      setItem(key, value) {
        sessionData.set(key, value);
      }
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    }
  };
  windowObject.top = windowObject;

  const context = {
    EasyModCapture: capture,
    URL,
    chrome: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve({ ok: true, payload: responsePayload });
        }
      }
    },
    window: windowObject
  };
  vm.runInNewContext(bridgeSource, context, { filename: 'content-bridge.js' });

  return new Promise((resolve) => {
    setImmediate(() => resolve({ messages, posted, sessionData }));
  });
}

function createBackgroundHarness() {
  const storage = fakeStorage();
  const listeners = [];
  const chrome = {
    runtime: {
      id: 'extension-id',
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    },
    storage: { session: storage }
  };
  const context = { chrome, URL };
  vm.createContext(context);
  context.importScripts = function (script) {
    assert.equal(script, 'lib/capture.js');
    vm.runInContext(captureSource, context, { filename: 'lib/capture.js' });
  };
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });

  return {
    storage,
    invoke(message, messageSender) {
      return new Promise((resolve) => {
        let responded = false;
        const sendResponse = (response) => {
          responded = true;
          resolve(response);
        };
        const keepChannelOpen = listeners[0](message, messageSender, sendResponse);
        if (keepChannelOpen !== true && !responded) resolve(null);
      });
    }
  };
}

test('content bridge is inert off exact /capture or without a valid nonce', async () => {
  const urls = [
    'https://growth.easymod.tech/prospects?captureNonce=' + TEST_NONCE,
    'https://growth.easymod.tech/capture',
    'https://growth.easymod.tech/capture?captureNonce=not-valid',
    'https://evil.example/capture?captureNonce=' + TEST_NONCE
  ];

  for (const url of urls) {
    const result = await runBridge(url, validPayload());
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.posted, []);
    assert.equal(result.sessionData.size, 0);
  }
});

test('content bridge sends only the validated nonce and target and preserves the payload shape', async () => {
  const url = capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE);
  const result = await runBridge(url, validPayload());

  assert.deepEqual(JSON.parse(JSON.stringify(result.messages)), [{
    type: capture.CLAIM_MESSAGE_TYPE,
    nonce: TEST_NONCE,
    targetOrigin: 'https://growth.easymod.tech',
    targetPath: '/capture'
  }]);
  assert.equal(result.posted.length, 1);
  assert.equal(result.posted[0].targetOrigin, 'https://growth.easymod.tech');
  assert.deepEqual(JSON.parse(JSON.stringify(result.posted[0].message)), {
    channel: capture.BRIDGE_CHANNEL,
    nonce: TEST_NONCE,
    targetOrigin: 'https://growth.easymod.tech',
    targetPath: '/capture',
    payload: validPayload()
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.posted[0].message.payload)), validPayload());
  assert.deepEqual(
    JSON.parse(result.sessionData.get(capture.CAPTURE_PAYLOAD_KEY)),
    validPayload()
  );
});

test('background rejects wrong target path, origin, and frame without consuming a pending entry', async () => {
  const harness = createBackgroundHarness();
  await harness.storage.set({ [capture.PENDING_CAPTURE_KEY]: pendingEntry() });

  const wrongPath = 'https://growth.easymod.tech/prospects?captureNonce=' + TEST_NONCE;
  const wrongPathResponse = await harness.invoke(claimMessage(capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE)), sender(wrongPath));
  assert.equal(wrongPathResponse.ok, false);
  assert.equal(wrongPathResponse.error, 'unauthorized_sender');
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), true);

  const wrongOrigin = 'https://evil.example/capture?captureNonce=' + TEST_NONCE;
  const wrongOriginResponse = await harness.invoke(claimMessage(capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE)), sender(wrongOrigin));
  assert.equal(wrongOriginResponse.ok, false);
  assert.equal(wrongOriginResponse.error, 'unauthorized_sender');
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), true);

  const validUrl = capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE);
  const wrongMessageTarget = claimMessage(validUrl);
  wrongMessageTarget.targetOrigin = 'http://127.0.0.1:5175';
  const wrongMessageResponse = await harness.invoke(wrongMessageTarget, sender(validUrl));
  assert.equal(wrongMessageResponse.ok, false);
  assert.equal(wrongMessageResponse.error, 'unauthorized_sender');
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), true);

  const wrongFrameResponse = await harness.invoke(claimMessage(validUrl), sender(validUrl, 7, 1));
  assert.equal(wrongFrameResponse.ok, false);
  assert.equal(wrongFrameResponse.error, 'unauthorized_sender');
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), true);
});

test('background serializes concurrent claims and delivers exactly one payload', async () => {
  const harness = createBackgroundHarness();
  const url = capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE);
  await harness.storage.set({ [capture.PENDING_CAPTURE_KEY]: pendingEntry() });

  const [first, second] = await Promise.all([
    harness.invoke(claimMessage(url), sender(url, 7)),
    harness.invoke(claimMessage(url), sender(url, 7))
  ]);
  const responses = [first, second];
  assert.equal(responses.filter((response) => response && response.payload).length, 1);
  assert.equal(responses.filter((response) => response && response.payload === null).length, 1);
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), false);
});

test('background honors a stored target tab binding', async () => {
  const harness = createBackgroundHarness();
  const url = capture.buildCapturePageUrl('https://growth.easymod.tech', TEST_NONCE);
  await harness.storage.set({ [capture.PENDING_CAPTURE_KEY]: pendingEntry(7) });

  const unrelated = await harness.invoke(claimMessage(url), sender(url, 8));
  assert.equal(unrelated.ok, true);
  assert.equal(unrelated.payload, null);
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), true);

  const target = await harness.invoke(claimMessage(url), sender(url, 7));
  assert.equal(target.ok, true);
  assert.equal(target.payload.businessName, 'Ravi Kebab House');
  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), false);
});
