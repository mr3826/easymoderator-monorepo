'use strict';

/* global apiBaseUrl, http, json */

const baseUrl = String(apiBaseUrl || '').replace(/\/$/, '');
const response = http.get(`${baseUrl}/health`);
if (!response.ok) {
  throw new Error(
    `BLOCKED: disposable backend health returned HTTP ${response.status}; cannot preflight Wave 2.5 state fixtures.`,
  );
}

const body = json(response.body);
const fixtures = body && body.mobileE2eFixtures;
if (
  !fixtures ||
  fixtures.emptyHome !== true ||
  fixtures.homeApiError !== true
) {
  throw new Error(
    'BLOCKED: current backend exposes no disposable emptyHome/homeApiError fixture toggles. ' +
      'seed-mobile-dev.js provides only the rich six-tier fixture and --remove; safely exercising ' +
      'Home empty and API-error states requires a test-only seed mode or backend toggle, not direct DB mutation or a production endpoint.',
  );
}

console.log('Wave 2.5 empty/error fixture capability: PASS.');
