'use strict';

/* global apiBaseUrl, controlToken, http, json */

// Hard preflight: every supplementary flow depends on these disposable
// controls. A missing capability fails the run instead of skipping flows.
const baseUrl = String(apiBaseUrl || '').replace(/\/$/, '');
const response = http.post(`${baseUrl}/api/mobile/e2e/control`, {
  headers: { 'Content-Type': 'application/json', 'X-Mobile-E2E-Control': controlToken || '' },
  body: JSON.stringify({ action: 'capabilities' }),
});
if (response.status !== 200) {
  throw new Error(
    `BLOCKED: the disposable backend's E2E controls are unavailable (HTTP ${response.status}). ` +
      'Start the backend through e2e/run-maestro.js --start-backend.',
  );
}

const capabilities = json(response.body).data || {};
const required = ['emptyHome', 'homeApiError', 'sessionExpiry', 'twoFactor', 'twoFactorExpiry', 'secondShop'];
const missing = required.filter((name) => capabilities[name] !== true);
if (missing.length > 0) {
  throw new Error(`BLOCKED: missing disposable E2E capabilities: ${missing.join(', ')}.`);
}
console.log(`Wave 2.5 fixture capabilities: PASS (${required.join(', ')}).`);
