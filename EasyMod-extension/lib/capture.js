/*
 * EasyModerator Lead Capture - shared pure logic (UMD).
 * Loaded by the extension (popup / service worker / content bridge via importScripts
 * or <script>) and by Node tests. No DOM, no Chrome API access in here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EasyModCapture = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function () {
  'use strict';

  // Session-scoped relay key held in chrome.storage.session (extension side).
  const PENDING_CAPTURE_KEY = 'pendin…lV1';
  // sessionStorage key the Growth SPA (/capture) reads on mount.
  const CAPTURE_PAYLOAD_KEY = 'growth-os.capture-payload.v1';
  const CLAIM_MESSAGE_TYPE = 'growth-os:capture:claim';
  const BRIDGE_CHANNEL = 'growth-os.capture-bridge.v1';
  const CAPTURE_PAGE_PATH = '/capture';
  const CAPTURE_NONCE_PARAM = 'captureNonce';
  const CAPTURE_NONCE_BYTES = 16;
  const CAPTURE_NONCE_HEX_LENGTH = CAPTURE_NONCE_BYTES * 2;
  const DEFAULT_TTL_MS = 5 * 60 * 1000;
  const MAX_CONTACT_CANDIDATES = 3;
  const VISIBLE_TEXT_SCAN_LIMIT = 20000;

  // First-party hosts: production SPA and the local dev server (port 5175).
  const GROWTH_ORIGINS = Object.freeze([
    'https://growth.easymod.tech',
    'http://127.0.0.1:5175'
  ]);

  // Manual capture is for ordinary public web pages, not social-platform or
  // messaging surfaces. Matching is done on exact roots and subdomains so a
  // deceptive host such as facebook.com.example cannot be blocked or allowed
  // by a substring accident.
  const SOCIAL_HOSTS = Object.freeze([
    'facebook.com',
    'fb.com',
    'fb.me',
    'instagram.com',
    'messenger.com',
    'm.me',
    'whatsapp.com',
    'wa.me',
    'threads.net',
    'twitter.com',
    'x.com',
    't.co',
    'linkedin.com',
    'lnkd.in',
    'tiktok.com',
    'youtube.com',
    'youtu.be',
    'reddit.com',
    'redd.it',
    'pinterest.com',
    'pin.it',
    'snapchat.com',
    'discord.com',
    'discord.gg',
    'telegram.org',
    't.me',
    'twitch.tv',
    'vk.com',
    'weibo.com',
    'bsky.app'
  ]);

  // Payload shape mirrors EasyMod-growth/src/pages/CapturePage.tsx exactly.
  const FIELD_LIMITS = Object.freeze({
    businessName: 255,
    pageUrl: 2048,
    sourceWebsite: 255,
    selectedText: 8000,
    contactPhone: 64,
    contactEmail: 320,
    note: 4000
  });
  const FIELDS = Object.freeze(Object.keys(FIELD_LIMITS));

  const EMAIL_FRAGMENT = String.raw`[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,10}`;
  const EMAIL_SCAN_RE = new RegExp(EMAIL_FRAGMENT, 'g');
  const EMAIL_STRICT_RE = new RegExp('^' + EMAIL_FRAGMENT + '$');

  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  function clampText(value, max) {
    const text = asText(value).trim();
    return text.length > max ? text.slice(0, max) : text;
  }

  function parseHttpUrl(value) {
    const raw = asText(value).trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function isSocialHost(hostname) {
    const normalizedHost = asText(hostname).toLowerCase().replace(/\.$/, '');
    return SOCIAL_HOSTS.some(function (root) {
      return normalizedHost === root || normalizedHost.endsWith('.' + root);
    });
  }

  function isSocialUrl(value) {
    const url = parseHttpUrl(value);
    return url !== null && isSocialHost(url.hostname);
  }

  function stripUrlCredentials(value) {
    const raw = asText(value).trim();
    const url = parseHttpUrl(raw);
    if (!url || (!url.username && !url.password)) return raw;
    url.username = '';
    url.password = '';
    return url.href;
  }

  function isGrowthUrl(value) {
    const url = parseHttpUrl(value);
    return url !== null && GROWTH_ORIGINS.indexOf(url.origin) !== -1;
  }

  function normalizeCaptureNonce(value) {
    if (typeof value !== 'string') return null;
    const nonce = value.trim().toLowerCase();
    return isValidCaptureNonce(nonce) ? nonce : null;
  }

  function isValidCaptureNonce(value) {
    return typeof value === 'string' && new RegExp('^[a-f0-9]{' + CAPTURE_NONCE_HEX_LENGTH + '}$').test(value);
  }

  function createCaptureNonce() {
    if (typeof globalThis === 'undefined' || !globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
      throw new Error('secure random values are unavailable');
    }
    const bytes = new Uint8Array(CAPTURE_NONCE_BYTES);
    globalThis.crypto.getRandomValues(bytes);
    let nonce = '';
    for (const byte of bytes) nonce += byte.toString(16).padStart(2, '0');
    return nonce;
  }

  function parseCapturePageUrl(value) {
    const url = parseHttpUrl(value);
    if (!url || GROWTH_ORIGINS.indexOf(url.origin) === -1) return null;
    if (url.username || url.password || url.pathname !== CAPTURE_PAGE_PATH || url.hash) return null;

    const queryKeys = Array.from(url.searchParams.keys());
    const queryNonces = url.searchParams.getAll(CAPTURE_NONCE_PARAM);
    if (queryKeys.length !== 1 || queryKeys[0] !== CAPTURE_NONCE_PARAM || queryNonces.length !== 1) return null;

    const nonce = normalizeCaptureNonce(queryNonces[0]);
    if (!nonce) return null;
    return Object.freeze({ origin: url.origin, pathname: url.pathname, nonce: nonce });
  }

  function isCapturableUrl(value) {
    const url = parseHttpUrl(value);
    return url !== null && GROWTH_ORIGINS.indexOf(url.origin) === -1 && !isSocialHost(url.hostname);
  }

  function collectHrefs(links) {
    const hrefs = [];
    if (Array.isArray(links)) {
      for (const link of links) {
        if (typeof link === 'string') hrefs.push(link);
        else if (link && typeof link.href === 'string') hrefs.push(link.href);
        if (hrefs.length >= 200) break;
      }
    }
    return hrefs;
  }

  function normalizeMailtoHref(href) {
    let value = href.replace(/^mailto:/i, '');
    value = value.split(/[?#&]/)[0];
    return value.trim();
  }

  function normalizeTelHref(href) {
    let value = href.replace(/^tel:/i, '');
    value = value.split(/[?#]/)[0];
    value = value.replace(/^["']+|["']+$/g, '');
    return value.trim();
  }

  function pushUnique(list, seen, candidate) {
    const lowered = candidate.toLowerCase();
    if (!candidate || seen.has(lowered) || list.length >= MAX_CONTACT_CANDIDATES) return;
    seen.add(lowered);
    list.push(candidate);
  }

  // mailto: link values first, then conservative visible-text matches,
  // capped at MAX_CONTACT_CANDIDATES. Never reads cookies/localStorage.
  function extractEmailAddresses(input) {
    const source = input || {};
    const candidates = [];
    const seen = new Set();
    for (const href of collectHrefs(source.links)) {
      if (!/^mailto:/i.test(href)) continue;
      const candidate = normalizeMailtoHref(href).toLowerCase();
      if (EMAIL_STRICT_RE.test(candidate)) pushUnique(candidates, seen, candidate);
    }
    const text = asText(source.visibleText).slice(0, VISIBLE_TEXT_SCAN_LIMIT);
    const matches = text.match(EMAIL_SCAN_RE) || [];
    for (const match of matches) {
      const candidate = match.toLowerCase();
      if (EMAIL_STRICT_RE.test(candidate)) pushUnique(candidates, seen, candidate);
    }
    return candidates;
  }

  // tel: link values only. Visible-text numbers are never guessed.
  function extractPhoneNumbers(input) {
    const source = input || {};
    const candidates = [];
    const seen = new Set();
    for (const href of collectHrefs(source.links)) {
      if (!/^tel:/i.test(href)) continue;
      const candidate = normalizeTelHref(href);
      if (candidate.replace(/\D/g, '').length < 3) continue;
      pushUnique(candidates, seen, candidate);
    }
    return candidates;
  }

  function defaultPayload() {
    const payload = {};
    for (const field of FIELDS) payload[field] = '';
    return payload;
  }

  function sanitizePayload(payload) {
    const clean = defaultPayload();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return clean;
    for (const field of FIELDS) {
      const value = field === 'pageUrl' ? stripUrlCredentials(payload[field]) : payload[field];
      clean[field] = clampText(value, FIELD_LIMITS[field]);
    }
    return clean;
  }

  function validatePayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['payload must be a plain object'] };
    }
    for (const key of Object.keys(payload)) {
      if (FIELDS.indexOf(key) === -1) errors.push('unknown field: ' + key);
    }
    for (const field of FIELDS) {
      const value = payload[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        errors.push(field + ' must be a string');
        continue;
      }
      if (value.length > FIELD_LIMITS[field]) {
        errors.push(field + ' exceeds ' + FIELD_LIMITS[field] + ' characters');
      }
    }
    if (typeof payload.businessName !== 'string' || !payload.businessName.trim()) {
      errors.push('businessName is required');
    }
    return { ok: errors.length === 0, errors };
  }

  function isValidTargetTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function normalizeBinding(binding, targetTabId) {
    let nonceValue = binding;
    let tabId = targetTabId;
    let targetOrigin;
    let targetPath;
    if (binding && typeof binding === 'object' && !Array.isArray(binding)) {
      nonceValue = binding.nonce;
      if (Object.prototype.hasOwnProperty.call(binding, 'targetTabId')) tabId = binding.targetTabId;
      targetOrigin = binding.targetOrigin;
      targetPath = binding.targetPath;
    }
    const nonce = normalizeCaptureNonce(nonceValue);
    if (!nonce) return null;
    if (tabId !== undefined && tabId !== null && !isValidTargetTabId(tabId)) return null;
    if (targetOrigin !== undefined && GROWTH_ORIGINS.indexOf(targetOrigin) === -1) return null;
    if (targetPath !== undefined && targetPath !== CAPTURE_PAGE_PATH) return null;
    return {
      nonce: nonce,
      targetTabId: tabId === undefined || tabId === null ? undefined : tabId,
      targetOrigin: targetOrigin,
      targetPath: targetPath
    };
  }

  function inspectPendingEntry(entry, currentTime, ttlMs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, remove: true };
    const allowedKeys = ['nonce', 'payload', 'createdAt', 'targetTabId', 'targetOrigin', 'targetPath'];
    if (Object.keys(entry).some((key) => allowedKeys.indexOf(key) === -1)) return { ok: false, remove: true };

    const nonce = normalizeCaptureNonce(entry.nonce);
    if (!nonce || typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)) {
      return { ok: false, remove: true };
    }
    const age = currentTime - entry.createdAt;
    if (age < 0 || age > ttlMs) return { ok: false, remove: true };
    if (Object.prototype.hasOwnProperty.call(entry, 'targetTabId') &&
        entry.targetTabId !== undefined && entry.targetTabId !== null &&
        !isValidTargetTabId(entry.targetTabId)) {
      return { ok: false, remove: true };
    }
    const hasTargetOrigin = Object.prototype.hasOwnProperty.call(entry, 'targetOrigin');
    const hasTargetPath = Object.prototype.hasOwnProperty.call(entry, 'targetPath');
    if (hasTargetOrigin !== hasTargetPath ||
        (hasTargetOrigin && GROWTH_ORIGINS.indexOf(entry.targetOrigin) === -1) ||
        (hasTargetPath && entry.targetPath !== CAPTURE_PAGE_PATH)) {
      return { ok: false, remove: true };
    }

    const checkedPayload = validatePayload(entry.payload);
    if (!checkedPayload.ok) return { ok: false, remove: true };
    return { ok: true, entry: entry, nonce: nonce, payload: sanitizePayload(entry.payload) };
  }

  /*
   * Session-scoped pending payload relay with nonce/path-bound claim-once
   * delivery and TTL expiry. `storage` is injected (chrome.storage.session in
   * the extension, a fake in tests) and must expose promise-based
   * get(key) -> { [key]: value }, set(obj), remove(key).
   */
  function createPendingCaptureStore(storage, options) {
    const settings = options || {};
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function' || typeof storage.remove !== 'function') {
      throw new Error('pending capture store requires get/set/remove storage');
    }
    const requestedTtl = settings.ttlMs;
    const ttlMs = typeof requestedTtl === 'number' && Number.isFinite(requestedTtl) && requestedTtl >= 0
      ? Math.min(requestedTtl, DEFAULT_TTL_MS)
      : DEFAULT_TTL_MS;
    const now = typeof settings.now === 'function' ? settings.now : function () { return Date.now(); };
    const key = typeof settings.key === 'string' ? settings.key : PENDING_CAPTURE_KEY;
    let operationQueue = Promise.resolve();

    function enqueue(operation) {
      const result = operationQueue.then(operation, operation);
      operationQueue = result.catch(function () {});
      return result;
    }

    return {
      key: key,
      ttlMs: ttlMs,

      put(payload, binding) {
        return enqueue(async function () {
          const result = validatePayload(payload);
          if (!result.ok) throw new Error('invalid capture payload: ' + result.errors.join('; '));
          const normalizedBinding = normalizeBinding(binding);
          if (!normalizedBinding) throw new Error('invalid capture nonce');

          const entry = {
            nonce: normalizedBinding.nonce,
            payload: sanitizePayload(payload),
            createdAt: now()
          };
          if (normalizedBinding.targetTabId !== undefined) entry.targetTabId = normalizedBinding.targetTabId;
          if (normalizedBinding.targetOrigin !== undefined) {
            entry.targetOrigin = normalizedBinding.targetOrigin;
            entry.targetPath = normalizedBinding.targetPath;
          }
          await storage.set({ [key]: entry });
          return entry.payload;
        });
      },

      // The queue keeps get/validate/remove one-at-a-time. Invalid or expired
      // entries are cleared; a nonce or target-tab mismatch is not consumed.
      claim(binding, targetTabId) {
        return enqueue(async function () {
          const normalizedBinding = normalizeBinding(binding, targetTabId);
          const stored = await storage.get(key);
          const entry = stored && stored[key];
          const inspected = inspectPendingEntry(entry, now(), ttlMs);
          if (!inspected.ok) {
            if (inspected.remove) await storage.remove(key);
            return null;
          }
          if (!normalizedBinding || inspected.nonce !== normalizedBinding.nonce) return null;
          if (inspected.entry.targetOrigin !== undefined &&
              (normalizedBinding.targetOrigin !== inspected.entry.targetOrigin ||
               normalizedBinding.targetPath !== inspected.entry.targetPath)) {
            return null;
          }

          const storedTargetTabId = inspected.entry.targetTabId;
          if (storedTargetTabId !== undefined && storedTargetTabId !== null &&
              (normalizedBinding.targetTabId === undefined || storedTargetTabId !== normalizedBinding.targetTabId)) {
            return null;
          }

          await storage.remove(key);
          return inspected.payload;
        });
      },

      bindTargetTab(binding, targetTabId) {
        return enqueue(async function () {
          const normalizedBinding = normalizeBinding(binding, targetTabId);
          if (!normalizedBinding || normalizedBinding.targetTabId === undefined) return false;

          const stored = await storage.get(key);
          const entry = stored && stored[key];
          const inspected = inspectPendingEntry(entry, now(), ttlMs);
          if (!inspected.ok) {
            if (inspected.remove) await storage.remove(key);
            return false;
          }
          if (inspected.nonce !== normalizedBinding.nonce) return false;
          if (inspected.entry.targetOrigin !== undefined &&
              (normalizedBinding.targetOrigin !== inspected.entry.targetOrigin ||
               normalizedBinding.targetPath !== inspected.entry.targetPath)) {
            return false;
          }
          if (inspected.entry.targetTabId !== undefined &&
              inspected.entry.targetTabId !== null &&
              inspected.entry.targetTabId !== normalizedBinding.targetTabId) return false;

          const boundEntry = {
            nonce: inspected.nonce,
            payload: inspected.payload,
            createdAt: inspected.entry.createdAt,
            targetTabId: normalizedBinding.targetTabId
          };
          const targetOrigin = inspected.entry.targetOrigin || normalizedBinding.targetOrigin;
          const targetPath = inspected.entry.targetPath || normalizedBinding.targetPath;
          if (targetOrigin !== undefined) {
            boundEntry.targetOrigin = targetOrigin;
            boundEntry.targetPath = targetPath;
          }
          await storage.set({ [key]: boundEntry });
          return true;
        });
      },

      clear() {
        return enqueue(async function () {
          await storage.remove(key);
        });
      }
    };
  }

  function buildCapturePageUrl(origin, nonce) {
    if (GROWTH_ORIGINS.indexOf(origin) === -1) {
      throw new Error('capture page origin must be a first-party Growth OS origin');
    }
    const normalizedNonce = normalizeCaptureNonce(nonce);
    if (!normalizedNonce) throw new Error('capture page URL requires a valid 128-bit nonce');
    const url = new URL(origin + CAPTURE_PAGE_PATH);
    url.searchParams.set(CAPTURE_NONCE_PARAM, normalizedNonce);
    return url.href;
  }

  return {
    PENDING_CAPTURE_KEY,
    CAPTURE_PAYLOAD_KEY,
    CLAIM_MESSAGE_TYPE,
    BRIDGE_CHANNEL,
    CAPTURE_PAGE_PATH,
    CAPTURE_NONCE_PARAM,
    CAPTURE_NONCE_BYTES,
    CAPTURE_NONCE_HEX_LENGTH,
    DEFAULT_TTL_MS,
    MAX_CONTACT_CANDIDATES,
    MAX_LINKS_SCAN: 200,
    VISIBLE_TEXT_SCAN_LIMIT,
    GROWTH_ORIGINS,
    FIELD_LIMITS,
    FIELDS,
    parseHttpUrl,
    isGrowthUrl,
    SOCIAL_HOSTS,
    isSocialUrl,
    stripUrlCredentials,
    isValidCaptureNonce,
    createCaptureNonce,
    parseCapturePageUrl,
    isCapturableUrl,
    extractEmailAddresses,
    extractPhoneNumbers,
    extractPageData,
    sanitizePayload,
    validatePayload,
    createPendingCaptureStore,
    buildCapturePageUrl
  };

  function extractPageData(input) {
    const source = input || {};
    const url = parseHttpUrl(source.url);
    if (!url || GROWTH_ORIGINS.indexOf(url.origin) !== -1 || isSocialHost(url.hostname)) return null;
    const emails = extractEmailAddresses({ links: source.links, visibleText: source.visibleText });
    const phones = extractPhoneNumbers({ links: source.links });
    return sanitizePayload({
      businessName: asText(source.title),
      pageUrl: stripUrlCredentials(url.href),
      sourceWebsite: url.hostname,
      selectedText: asText(source.selection),
      contactPhone: phones[0] || '',
      contactEmail: emails[0] || '',
      note: asText(source.note)
    });
  }
});
