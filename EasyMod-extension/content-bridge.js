/*
 * Content bridge - the manifest injects this file on first-party Growth OS
 * hosts, but the relay runs only in the top frame at the exact /capture path
 * with a validated nonce. It claims the session-scoped payload from the
 * service worker (nonce/path-bound, single delivery) and hands it to the SPA:
 *   1. Primary: sessionStorage['growth-os.capture-payload.v1'] - the key
 *      CapturePage.tsx already reads. Any stale relayed value is replaced.
 *   2. Secondary: window.postMessage({ channel, nonce, targetOrigin,
 *      targetPath, payload }) to same origin.
 * The SPA clears sessionStorage after the record is created; the worker clears
 * its matching pending copy only after the serialized claim succeeds.
 */
(function () {
  'use strict';

  const API = globalThis.EasyModCapture;
  if (!API) return;

  try {
    if (window.top !== window) return;
  } catch (error) {
    return;
  }

  if (window.location.pathname !== API.CAPTURE_PAGE_PATH) return;
  const captureTarget = API.parseCapturePageUrl(window.location.href);
  if (!captureTarget || !captureTarget.nonce) return;

  async function relayCapturePayload() {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: API.CLAIM_MESSAGE_TYPE,
        nonce: captureTarget.nonce,
        targetOrigin: captureTarget.origin,
        targetPath: captureTarget.pathname
      });
    } catch (error) {
      return;
    }
    if (!response || response.ok !== true || !response.payload) return;

    let payload;
    try {
      payload = API.sanitizePayload(response.payload);
    } catch (error) {
      return;
    }
    if (!payload.businessName) return;

    try {
      window.sessionStorage.removeItem(API.CAPTURE_PAYLOAD_KEY);
      window.sessionStorage.setItem(API.CAPTURE_PAYLOAD_KEY, JSON.stringify(payload));
    } catch (error) {
      /* storage unavailable (private mode restrictions): fall through to postMessage */
    }

    try {
      window.postMessage({
        channel: API.BRIDGE_CHANNEL,
        nonce: captureTarget.nonce,
        targetOrigin: captureTarget.origin,
        targetPath: captureTarget.pathname,
        payload: payload
      }, window.location.origin);
    } catch (error) {
      /* page context refused the message; sessionStorage remains primary */
    }
  }

  void relayCapturePayload();
})();
