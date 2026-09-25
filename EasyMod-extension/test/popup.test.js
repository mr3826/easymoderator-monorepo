'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const capture = require('../lib/capture.js');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function fakeStorage() {
  const data = new Map();
  return {
    data,
    async get(key) {
      const shaped = {};
      if (data.has(key)) shaped[key] = data.get(key);
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

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createElements() {
  const elements = new Map();
  for (const id of [
    'capture-form',
    'status',
    'continue-button',
    'clear-button',
    'email-candidates',
    ...capture.FIELDS.map((field) => 'field-' + field)
  ]) {
    elements.set(id, {
      id,
      value: '',
      hidden: id === 'capture-form',
      textContent: '',
      className: '',
      disabled: false,
      listeners: new Map(),
      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      },
      focus() {}
    });
  }
  return elements;
}

async function runPopup({
  tabUrl = 'https://ordinary-business.example/listing',
  captureTab = { id: 42 },
  createTab,
  manifestHosts = ['https://growth.easymod.tech/*'],
  snapshot = {
    title: 'Ordinary Business',
    url: tabUrl,
    selection: '',
    links: [],
    visibleText: ''
  }
} = {}) {
  const elements = createElements();
  const storage = fakeStorage();
  const createdUrls = [];
  const updatedUrls = [];
  const windowObject = {
    setTimeout() {
      return 1;
    },
    close() {}
  };
  const documentObject = {
    getElementById(id) {
      return elements.get(id);
    }
  };
  const chromeObject = {
    runtime: {
      getManifest() {
        return { host_permissions: manifestHosts };
      }
    },
    tabs: {
      async query() {
        return [{ id: 7, url: tabUrl }];
      },
      async create(details) {
        createdUrls.push(details.url);
        if (createTab) return createTab(details);
        return captureTab;
      },
      async update(_tabId, details) {
        updatedUrls.push(details.url);
        return captureTab;
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: snapshot }];
      }
    },
    storage: { session: storage }
  };
  const context = {
    EasyModCapture: capture,
    chrome: chromeObject,
    crypto: crypto.webcrypto,
    document: documentObject,
    window: windowObject
  };
  vm.runInNewContext(popupSource, context, { filename: 'popup.js' });
  await flush();

  return {
    elements,
    storage,
    createdUrls,
    updatedUrls,
    async submit() {
      const event = { preventDefault() {} };
      elements.get('capture-form').listeners.get('submit')(event);
      await flush();
      await flush();
    }
  };
}

test('popup refuses social pages before injecting or showing a preview', async () => {
  const harness = await runPopup({ tabUrl: 'https://business.facebook.com/page' });

  assert.equal(harness.elements.get('capture-form').hidden, true);
  assert.match(harness.elements.get('status').textContent, /Social-platform pages are not captured/);
  assert.equal(harness.createdUrls.length, 0);
});

test('popup clears the pending relay when the Growth target tab cannot be opened', async () => {
  const harness = await runPopup({
    createTab() {
      throw new Error('tabs.create unavailable');
    }
  });

  await harness.submit();

  assert.equal(harness.storage.data.has(capture.PENDING_CAPTURE_KEY), false);
  assert.match(harness.elements.get('status').textContent, /tabs\.create unavailable/);
});

test('popup selects the loopback handoff from the development manifest', async () => {
  const harness = await runPopup({
    manifestHosts: ['https://growth.easymod.tech/*', 'http://127.0.0.1:5175/*']
  });

  await harness.submit();

  assert.match(
    harness.updatedUrls[0],
    /^http:\/\/127\.0\.0\.1:5175\/capture\?captureNonce=[a-f0-9]{32}$/
  );
  const pending = harness.storage.data.get(capture.PENDING_CAPTURE_KEY);
  assert.equal(pending.targetOrigin, 'http://127.0.0.1:5175');
  assert.equal(pending.targetTabId, 42);
});
