/*
 * Minimal MV3 service worker: session-scoped relay for manual captures.
 * The popup writes a nonce-bound entry to chrome.storage.session before opening
 * Growth OS, then may close. The top-frame bridge can claim only from the exact
 * first-party /capture path carrying that nonce; a target tab binding is added
 * before the capture tab loads. Claims are serialized
 * so get/validate/remove is claim-once even for concurrent messages.
 * This worker never performs network requests and never touches cookies/history.
 */
'use strict';

importScripts('lib/capture.js');

const API = globalThis.EasyModCapture;
const pendingStore = API.createPendingCaptureStore(chrome.storage.session);
let claimQueue = Promise.resolve();

function getAllowedTarget(message, sender) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  if (!sender || !sender.tab || typeof sender.tab.url !== 'string') return null;
  if (sender.id !== chrome.runtime.id) return null;
  if (sender.frameId !== 0) return null;
  if (!Number.isInteger(sender.tab.id) || sender.tab.id < 0) return null;

  const target = API.parseCapturePageUrl(sender.tab.url);
  if (!target || message.nonce !== target.nonce) return null;
  if (message.targetOrigin !== target.origin || message.targetPath !== target.pathname) return null;
  return { nonce: target.nonce, targetOrigin: target.origin, targetPath: target.pathname, tabId: sender.tab.id };
}

function enqueueClaim(operation) {
  const result = claimQueue.then(operation, operation);
  claimQueue = result.catch(function () {});
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== API.CLAIM_MESSAGE_TYPE) return false;

  const target = getAllowedTarget(message, sender);
  if (!target) {
    sendResponse({ ok: false, payload: null, error: 'unauthorized_sender' });
    return false;
  }

  void enqueueClaim(async () => {
    let payload = null;
    try {
      payload = await pendingStore.claim({
        nonce: target.nonce,
        targetTabId: target.tabId,
        targetOrigin: target.targetOrigin,
        targetPath: target.targetPath
      });
    } catch (error) {
      payload = null;
    }
    sendResponse({ ok: true, payload });
  });

  return true;
});
