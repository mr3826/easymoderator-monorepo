'use strict';

/* global apiBaseUrl, controlToken, action, endpoint, failures, http, json, output */

// Calls the disposable backend's E2E control route (EasyMod-backend
// src/modules/mobile/mobile-e2e-fixtures.js). The per-run token exists only in
// the runner's memory and the backend it started; in any other backend the
// route is not even registered.
const baseUrl = String(apiBaseUrl || '').replace(/\/$/, '');
if (!controlToken) {
  throw new Error('BLOCKED: E2E_CONTROL_TOKEN is not set; run flows through e2e/run-maestro.js.');
}

const body = { action };
if (typeof endpoint !== 'undefined' && endpoint) body.endpoint = endpoint;
if (typeof failures !== 'undefined' && failures) body.failures = Number(failures);

const response = http.post(`${baseUrl}/api/mobile/e2e/control`, {
  headers: {
    'Content-Type': 'application/json',
    'X-Mobile-E2E-Control': controlToken,
  },
  body: JSON.stringify(body),
});
if (response.status < 200 || response.status >= 300) {
  throw new Error(`E2E fixture control "${action}" returned HTTP ${response.status}.`);
}

output.fixture = json(response.body).data;
console.log(`E2E fixture control "${action}": OK`);
