/*
 * Popup UI: manual capture only. Reads the ACTIVE tab once, when the operator
 * clicks the toolbar action, via activeTab + scripting. Builds an editable
 * preview from lib/capture.js. On "Continue in Growth OS" it stores the payload
 * with a random 128-bit nonce in chrome.storage.session and opens the exact
 * Growth OS /capture URL carrying only that nonce. Duplicate preflight and
 * record creation happen in the Growth SPA behind the operator's own
 * authenticated session.
 */
(function () {
  'use strict';

  const API = globalThis.EasyModCapture;

  const FIELD_IDS = API.FIELDS.map(function (field) {
    return { field: field, element: document.getElementById('field-' + field) };
  });

  const form = document.getElementById('capture-form');
  const statusBox = document.getElementById('status');
  const continueButton = document.getElementById('continue-button');
  const clearButton = document.getElementById('clear-button');
  const candidatesBox = document.getElementById('email-candidates');

  let lastCandidateList = [];

  // The release manifest targets production. The disposable development
  // manifest advertises the loopback Growth origin, so local hand-off follows
  // the manifest instead of relying on a separately edited source constant.
  function getCaptureTargetOrigin() {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
      const manifest = chrome.runtime.getManifest();
      if (manifest && Array.isArray(manifest.host_permissions) &&
          manifest.host_permissions.indexOf(API.GROWTH_ORIGINS[1] + '/*') !== -1) {
        return API.GROWTH_ORIGINS[1];
      }
    }
    return API.GROWTH_ORIGINS[0];
  }

  const CAPTURE_TARGET_ORIGIN = getCaptureTargetOrigin();

  // Serialized into the page by chrome.scripting; must stay self-contained.
  // Reads only the title, visible selection, mailto:/tel: anchors, and a
  // capped slice of visible text. No cookies, no storage, no network.
  function collectPageSnapshot() {
    const hrefs = [];
    const anchors = document.querySelectorAll('a[href]');
    for (let i = 0; i < anchors.length && hrefs.length < 100; i += 1) {
      const href = anchors[i].getAttribute('href') || '';
      if (/^(mailto|tel):/i.test(href)) hrefs.push(href);
    }
    let selection = '';
    try {
      selection = String(window.getSelection() || '');
    } catch (error) {
      selection = '';
    }
    let visibleText = '';
    if (document.body && typeof document.body.innerText === 'string') {
      visibleText = document.body.innerText.slice(0, 20000);
    }
    return {
      title: document.title || '',
      url: String(window.location.href || ''),
      selection: selection,
      links: hrefs,
      visibleText: visibleText
    };
  }

  function showMessage(text, kind) {
    statusBox.textContent = text;
    statusBox.className = 'status ' + (kind === 'info' ? 'info' : 'error');
    statusBox.hidden = false;
  }

  function hideMessage() {
    statusBox.textContent = '';
    statusBox.hidden = true;
  }

  function blockCapture(message) {
    form.hidden = true;
    showMessage(message, 'info');
  }

  function fillPreview(payload) {
    for (const entry of FIELD_IDS) {
      entry.element.value = payload[entry.field] || '';
    }
    form.hidden = false;
  }

  function readFormPayload() {
    const payload = {};
    for (const entry of FIELD_IDS) {
      payload[entry.field] = entry.element.value;
    }
    return API.sanitizePayload(payload);
  }

  function showEmailCandidates(list) {
    if (!list || list.length < 2) {
      candidatesBox.hidden = true;
      candidatesBox.textContent = '';
      return;
    }
    candidatesBox.hidden = false;
    candidatesBox.textContent =
      'Other visible addresses found: ' + list.slice(1).join(', ') + ' - edit the field to choose.';
  }

  function hasContactChannel(payload) {
    return [payload.pageUrl, payload.contactPhone, payload.contactEmail].some(function (value) {
      return Boolean(value && value.trim());
    });
  }

  async function captureFromActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
      showMessage('Chrome extension APIs are unavailable in this context.', 'error');
      return;
    }

    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (error) {
      showMessage('The current tab could not be read. Try again.', 'error');
      return;
    }
    const tab = tabs && tabs[0];
    const url = (tab && tab.url) || '';

    if (!tab || tab.id === undefined) {
      blockCapture('No active tab was found to capture.');
      return;
    }
    if (API.isGrowthUrl(url)) {
      blockCapture(
        'You are already on a Growth OS page. Open the business page you want to capture, select its ' +
          'key details, and click the EasyModerator icon there.'
      );
      return;
    }
    if (API.isSocialUrl(url)) {
      blockCapture(
        'Social-platform pages are not captured. Open the ordinary public business website instead; ' +
          'the extension does not read Facebook, Instagram, Messenger, WhatsApp, or equivalent social hosts.'
      );
      return;
    }
    if (!API.isCapturableUrl(url)) {
      blockCapture(
        'This page type cannot be captured. Lead capture works only on regular web pages that start ' +
          'with http:// or https://.'
      );
      return;
    }

    let injection;

    try {
      injection = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectPageSnapshot
      });
    } catch (error) {
      blockCapture(
        'This page blocked the one-time read (Chrome protects some pages, e.g. Web Store and other ' +
          'extensions). Reload a normal business page and click the icon again.'
      );
      return;
    }

    const snapshot = injection && injection[0] && injection[0].result;
    if (!snapshot) {
      blockCapture('The page could not be read. Scroll to the listing and try again.');
      return;
    }

    const payload = API.extractPageData(snapshot);
    if (!payload) {
      blockCapture('The page address changed to a type that cannot be captured.');
      return;
    }

    hideMessage();
    fillPreview(payload);
    lastCandidateList = API.extractEmailAddresses({
      links: snapshot.links,
      visibleText: snapshot.visibleText
    });
    showEmailCandidates(lastCandidateList);
  }

  async function handleContinue(event) {
    event.preventDefault();
    hideMessage();
    continueButton.disabled = true;

    let store = null;
    let captureNonce = null;
    let pendingStored = false;

    try {
      const payload = readFormPayload();
      const errors = [];
      const validation = API.validatePayload(payload);
      if (!validation.ok) {
        errors.push(...validation.errors);
      } else if (!hasContactChannel(payload)) {
        errors.push('Fill in at least one of page URL, phone, or email (this prevents duplicate-prone empty records).');
      }
      if (payload.contactEmail && !/^\S+@\S+\.\S+$/.test(payload.contactEmail.trim())) {
        errors.push('Enter a valid contact email address, or clear the field.');
      }
      if (errors.length > 0) {
        showMessage(errors.join(' '), 'error');
        return;
      }

      store = API.createPendingCaptureStore(chrome.storage.session);
      captureNonce = API.createCaptureNonce();
      await store.put(payload, {
        nonce: captureNonce,
        targetOrigin: CAPTURE_TARGET_ORIGIN,
        targetPath: API.CAPTURE_PAGE_PATH
      });
      pendingStored = true;
       // Bind before loading /capture so the bridge cannot claim the entry
       // before the popup associates it with the tab Chrome just created.
       const captureTab = await chrome.tabs.create({ url: 'about:blank' });
      if (!captureTab || !Number.isInteger(captureTab.id)) {
        throw new Error('Growth OS target tab was not opened');
      }
      const bound = await store.bindTargetTab({
        nonce: captureNonce,
        targetTabId: captureTab.id,
        targetOrigin: CAPTURE_TARGET_ORIGIN,
        targetPath: API.CAPTURE_PAGE_PATH
       });
       if (!bound) throw new Error('Growth OS target tab could not be bound');
       await chrome.tabs.update(captureTab.id, {
         url: API.buildCapturePageUrl(CAPTURE_TARGET_ORIGIN, captureNonce)
       });
      showMessage('Opened Growth OS for review. Nothing was saved yet - confirm there.', 'info');
      window.setTimeout(function () { window.close(); }, 400);
    } catch (error) {
      if (pendingStored && store) {
        try {
          await store.clear();
        } catch {
          /* The original hand-off error is more useful to the operator. */
        }
      }
      showMessage(
        'The capture could not be handed to Growth OS (' + (error && error.message ? error.message : 'unknown error') + '). Nothing was saved.',
        'error'
      );
    } finally {
      continueButton.disabled = false;
    }
  }

  function handleClearAll() {
    for (const entry of FIELD_IDS) {
      entry.element.value = '';
    }
    showEmailCandidates([]);
    hideMessage();
    FIELD_IDS[0].element.focus();
  }

  form.addEventListener('submit', function (event) {
    void handleContinue(event);
  });
  clearButton.addEventListener('click', handleClearAll);
  document.getElementById('field-contactEmail').addEventListener('input', function () {
    showEmailCandidates([]);
  });

  void captureFromActiveTab();
})();
