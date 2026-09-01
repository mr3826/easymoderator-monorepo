#!/usr/bin/env node
'use strict';

/**
 * Read-only Meta Page-discovery probe.
 *
 * Usage:
 *   META_PAGE_DISCOVERY_USER_TOKEN=<user-token> \
 *   META_APP_ID=<app-id> META_APP_SECRET=<app-secret> \
 *   node scripts/meta-page-discovery-probe.js
 *
 * The user token is accepted from META_PAGE_DISCOVERY_USER_TOKEN or the shorter
 * META_DISCOVERY_USER_TOKEN alias. The probe never prints either token, the app
 * secret, appsecret_proof, Graph error messages, or raw Graph responses.
 */

require('dotenv').config();

const axios = require('axios');
const crypto = require('crypto');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_FIELDS = 'id,name,category,access_token,picture{data{url}},tasks';
const PAGE_HYDRATION_FIELDS = 'id,name,category,picture{data{url}},tasks,access_token';
const GRANULAR_SCOPES = ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'];
const HYDRATION_CONCURRENCY = 5;
const USER_TOKEN_ENV_NAMES = ['META_PAGE_DISCOVERY_USER_TOKEN', 'META_DISCOVERY_USER_TOKEN'];

const line = (value) => process.stdout.write(`${value}\n`);

function graphErrorDetails(error) {
    return {
        code: error?.response?.data?.error?.code || 'UNKNOWN',
        subcode: error?.response?.data?.error?.error_subcode || 'NONE',
    };
}

function appsecretProof(token, appSecret) {
    return crypto.createHmac('sha256', appSecret).update(token).digest('hex');
}

function hasNonEmptyAccessToken(page) {
    return typeof page?.access_token === 'string' && page.access_token.trim().length > 0;
}

function pageId(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return String(value);
}

function targetIdsForScope(granularScopes, scope) {
    const entry = granularScopes.find((candidate) => candidate?.scope === scope);
    return new Set(
        (Array.isArray(entry?.target_ids) ? entry.target_ids : [])
            .map(pageId)
            .filter(Boolean),
    );
}

/**
 * Follow only cursor values. Meta's `paging.next` URL contains the access
 * token, so it is deliberately never used or logged.
 */
async function paginateGraphCollection(url, params) {
    const rows = [];
    let after = params?.after ?? null;
    const seenCursors = new Set();

    while (true) {
        const response = await axios.get(url, {
            params: after !== null && after !== undefined && String(after).length > 0
                ? { ...params, after }
                : { ...params },
        });
        const batch = Array.isArray(response.data?.data) ? response.data.data : [];
        rows.push(...batch);

        const nextAfter = response.data?.paging?.cursors?.after;
        if (nextAfter === null || nextAfter === undefined || String(nextAfter).length === 0) break;

        const cursor = String(nextAfter);
        if (cursor === String(after) || seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
        after = nextAfter;
    }

    return rows;
}

async function mapWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, values.length);

    const worker = async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= values.length) return;
            results[index] = await mapper(values[index]);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function hydratePage(pageIdValue, userToken, proof) {
    try {
        const response = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(pageIdValue)}`, {
            params: {
                fields: PAGE_HYDRATION_FIELDS,
                access_token: userToken,
                appsecret_proof: proof,
            },
        });
        const page = response.data;
        if (pageId(page?.id) !== pageIdValue) {
            return { status: 'FAIL', page: null, code: 'ID_MISMATCH', subcode: 'NONE' };
        }
        if (!hasNonEmptyAccessToken(page)) {
            return { status: 'FAIL', page: null, code: 'ACCESS_TOKEN_MISSING', subcode: 'NONE' };
        }
        return { status: 'PASS', page, code: null, subcode: null };
    } catch (error) {
        const { code, subcode } = graphErrorDetails(error);
        return { status: 'FAIL', page: null, code, subcode };
    }
}

function printScopeEvidence(scopeTargetIds) {
    const allTargetIds = [...new Set(GRANULAR_SCOPES.flatMap((scope) => [...scopeTargetIds[scope]]))]
        .sort();
    for (const scope of GRANULAR_SCOPES) {
        const ids = allTargetIds.length ? allTargetIds : ['NONE'];
        for (const id of ids) {
            const present = id !== 'NONE' && scopeTargetIds[scope].has(id);
            line(`PAGE_IN_GRANULAR_TARGET_IDS=${present ? 'YES' : 'NO'} scope=${scope} page_id=${id}`);
        }
    }
    return allTargetIds;
}

function rootCause({ grantedCount, missingCount, hydrationFailureCount, hydrationSuccessCount }) {
    if (grantedCount === 0) return 'NO_PAGES_MESSAGING_TARGET_IDS';
    if (missingCount === 0) return 'ME_ACCOUNTS_CONTAINS_GRANTED_TARGETS';
    if (hydrationFailureCount > 0) return 'DIRECT_TARGET_ID_HYDRATION_FAILED';
    if (hydrationSuccessCount === missingCount) return 'ME_ACCOUNTS_OMITS_GRANTED_TARGETS_HYDRATION_PASS';
    return 'DIRECT_TARGET_ID_HYDRATION_INCOMPLETE';
}

async function main() {
    const userToken = USER_TOKEN_ENV_NAMES
        .map((name) => process.env[name])
        .find((value) => typeof value === 'string' && value.trim().length > 0);
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!userToken) {
        line('PROBE_STATUS=FAIL reason=MISSING_ENV:META_PAGE_DISCOVERY_USER_TOKEN');
        process.exitCode = 1;
        return;
    }
    if (!appId || !appSecret) {
        line('PROBE_STATUS=FAIL reason=MISSING_ENV:META_APP_ID_OR_META_APP_SECRET');
        process.exitCode = 1;
        return;
    }

    const proof = appsecretProof(userToken, appSecret);
    const appAccessToken = `${appId}|${appSecret}`;
    let debugData;
    try {
        const response = await axios.get(`${GRAPH_BASE}/debug_token`, {
            params: {
                input_token: userToken,
                access_token: appAccessToken,
                appsecret_proof: appsecretProof(appAccessToken, appSecret),
            },
        });
        debugData = response.data?.data || {};
    } catch (error) {
        const { code, subcode } = graphErrorDetails(error);
        line(`DEBUG_TOKEN=FAIL graph_code=${code} graph_subcode=${subcode}`);
        line('PROBE_STATUS=FAIL');
        process.exitCode = 1;
        return;
    }

    const granularScopes = Array.isArray(debugData.granular_scopes) ? debugData.granular_scopes : [];
    const scopeTargetIds = Object.fromEntries(
        GRANULAR_SCOPES.map((scope) => [scope, targetIdsForScope(granularScopes, scope)]),
    );
    const grantedPageIds = [...scopeTargetIds.pages_messaging].sort();

    let meAccounts;
    try {
        meAccounts = await paginateGraphCollection(`${GRAPH_BASE}/me/accounts`, {
            fields: PAGE_FIELDS,
            limit: 100,
            access_token: userToken,
            appsecret_proof: proof,
        });
    } catch (error) {
        const { code, subcode } = graphErrorDetails(error);
        line(`PAGE_IN_ME_ACCOUNTS=FAIL graph_code=${code} graph_subcode=${subcode}`);
        line('PROBE_STATUS=FAIL');
        process.exitCode = 1;
        return;
    }

    printScopeEvidence(scopeTargetIds);

    const meAccountsById = new Map();
    for (const page of meAccounts) {
        const id = pageId(page?.id);
        if (!id) continue;
        const current = meAccountsById.get(id);
        if (!current || (!hasNonEmptyAccessToken(current) && hasNonEmptyAccessToken(page))) {
            meAccountsById.set(id, page);
        }
    }

    for (const id of grantedPageIds.length ? grantedPageIds : ['NONE']) {
        line(`PAGE_IN_ME_ACCOUNTS=${id !== 'NONE' && meAccountsById.has(id) ? 'YES' : 'NO'} page_id=${id}`);
    }

    const targetsNeedingHydration = grantedPageIds.filter((id) => !hasNonEmptyAccessToken(meAccountsById.get(id)));
    const hydrationResults = await mapWithConcurrency(
        targetsNeedingHydration,
        HYDRATION_CONCURRENCY,
        (id) => hydratePage(id, userToken, proof),
    );

    let hydrationFailures = 0;
    let hydrationSuccesses = 0;
    hydrationResults.forEach((result, index) => {
        const id = targetsNeedingHydration[index];
        if (result.status === 'PASS') hydrationSuccesses += 1;
        else hydrationFailures += 1;
        const detail = result.status === 'FAIL'
            ? ` graph_code=${result.code} graph_subcode=${result.subcode}`
            : '';
        line(`DIRECT_TARGET_ID_HYDRATION=${result.status} page_id=${id}${detail}`);
        line(`HYDRATED_PAGE_HAS_ACCESS_TOKEN=${result.status === 'PASS' ? 'YES' : 'NO'} page_id=${id}`);
        const tasks = result.page && Array.isArray(result.page.tasks) ? result.page.tasks : [];
        line(`HYDRATED_PAGE_TASKS=${JSON.stringify(tasks)} page_id=${id}`);
    });
    if (targetsNeedingHydration.length === 0) {
        line('DIRECT_TARGET_ID_HYDRATION=PASS page_id=NONE count=0');
    }

    line(`MISSING_TARGET_ID_COUNT=${targetsNeedingHydration.length}`);
    line(`HYDRATION_PASS_COUNT=${hydrationSuccesses}`);
    line(`HYDRATION_FAIL_COUNT=${hydrationFailures}`);
    line(`ROOT_CAUSE=${rootCause({
        grantedCount: grantedPageIds.length,
        missingCount: targetsNeedingHydration.length,
        hydrationFailureCount: hydrationFailures,
        hydrationSuccessCount: hydrationSuccesses,
    })}`);
    line(`PROBE_STATUS=${hydrationFailures === 0 ? 'PASS' : 'FAIL'}`);
    if (hydrationFailures > 0) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        // Do not print an arbitrary exception: request/config details can carry
        // credentials. The per-call paths above already emit safe diagnostics.
        line('PROBE_STATUS=FAIL reason=UNEXPECTED_PROBE_FAILURE');
        process.exitCode = 1;
    });
}

module.exports = {
    appsecretProof,
    hasNonEmptyAccessToken,
    paginateGraphCollection,
    targetIdsForScope,
};
