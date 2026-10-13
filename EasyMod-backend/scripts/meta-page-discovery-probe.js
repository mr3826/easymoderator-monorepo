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
const MINIMAL_PAGE_FIELDS = 'id,name';
const PAGE_TOKEN_FIELDS = 'id,name,access_token';
const PAGE_FIELDS = 'id,name,category,access_token,picture{data{url}},tasks';
const PAGE_HYDRATION_FIELDS = 'id,name,category,picture{data{url}},tasks,access_token';
const GRANULAR_SCOPES = ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'];
const HYDRATION_CONCURRENCY = 5;
const USER_TOKEN_ENV_NAMES = ['META_PAGE_DISCOVERY_USER_TOKEN', 'META_DISCOVERY_USER_TOKEN'];

const line = (value) => process.stdout.write(`${value}\n`);

function graphErrorDetails(error) {
    return {
        httpStatus: error?.response?.status || 'UNKNOWN',
        code: error?.response?.data?.error?.code || 'UNKNOWN',
        subcode: error?.response?.data?.error?.error_subcode || 'NONE',
        fbtraceId: error?.response?.data?.error?.fbtrace_id || 'NONE',
    };
}

function graphErrorClassification(code, httpStatus) {
    if (String(code) === '100') return 'OBJECT_NOT_FOUND_OR_NOT_VISIBLE';
    if (String(code) === '190') return 'INVALID_OR_EXPIRED_TOKEN';
    if (String(code) === '200') return 'PERMISSION_OR_ROLE_REQUIRED';
    if (Number(httpStatus) >= 500) return 'GRAPH_SERVER_ERROR';
    if (Number(httpStatus) >= 400) return 'GRAPH_REQUEST_REJECTED';
    return 'UNKNOWN';
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

function safeScopeEvidence(debugData, appId, expectedPageId) {
    const granularScopes = Array.isArray(debugData?.granular_scopes)
        ? debugData.granular_scopes
        : [];
    const scopeTargetIds = Object.fromEntries(
        GRANULAR_SCOPES.map((scope) => [scope, targetIdsForScope(granularScopes, scope)]),
    );
    const grantedScopes = Array.isArray(debugData?.scopes)
        ? debugData.scopes.filter((scope) => typeof scope === 'string').sort()
        : [];

    return {
        tokenValid: debugData?.is_valid === true ? 'YES' : 'NO',
        tokenAppIdMatches: String(debugData?.app_id || '') === String(appId) ? 'YES' : 'NO',
        tokenType: typeof debugData?.type === 'string' ? debugData.type : 'UNKNOWN',
        grantedScopes,
        businessManagementGranted: grantedScopes.includes('business_management') ? 'YES' : 'NO',
        granularTargets: Object.fromEntries(
            GRANULAR_SCOPES.map((scope) => [scope, {
                granted: scopeTargetIds[scope].size > 0 ? 'YES' : 'NO',
                expectedPage: expectedPageId && scopeTargetIds[scope].has(String(expectedPageId))
                    ? 'YES'
                    : 'NO',
            }]),
        ),
        scopeTargetIds,
    };
}

function summarizeRows(rows, expectedPageId, tokenRequested) {
    const expectedId = pageId(expectedPageId);
    const expectedPage = rows.find((row) => pageId(row?.id) === expectedId);
    return {
        pageCount: rows.length,
        expectedPageVisible: expectedPage ? 'YES' : 'NO',
        pageTokenAvailable: tokenRequested
            ? (expectedPage ? (hasNonEmptyAccessToken(expectedPage) ? 'YES' : 'NO') : 'NO')
            : 'NOT_REQUESTED',
        tasks: expectedPage && Array.isArray(expectedPage.tasks)
            ? expectedPage.tasks.filter((task) => typeof task === 'string').sort()
            : [],
    };
}

async function requestCollection({ request, url, params, expectedPageId, tokenRequested }) {
    const rows = [];
    let after = null;
    let httpStatus = 'UNKNOWN';
    const seenCursors = new Set();

    try {
        while (true) {
            const response = await request(url, {
                params: after ? { ...params, after } : { ...params },
            });
            httpStatus = response.status || 200;
            rows.push(...(Array.isArray(response.data?.data) ? response.data.data : []));
            const nextAfter = response.data?.paging?.cursors?.after;
            if (!nextAfter || seenCursors.has(String(nextAfter))) break;
            seenCursors.add(String(nextAfter));
            after = nextAfter;
        }
        return {
            status: 'PASS',
            httpStatus,
            ...summarizeRows(rows, expectedPageId, tokenRequested),
            graphError: null,
        };
    } catch (error) {
        const details = graphErrorDetails(error);
        return {
            status: 'FAIL',
            httpStatus: details.httpStatus,
            ...summarizeRows(rows, expectedPageId, tokenRequested),
            graphError: {
                code: details.code,
                subcode: details.subcode,
                fbtraceId: details.fbtraceId,
                classification: graphErrorClassification(details.code, details.httpStatus),
            },
        };
    }
}

async function requestPage({ request, url, fields, userToken, proof, expectedPageId }) {
    try {
        const response = await request(url, {
            params: {
                fields,
                access_token: userToken,
                appsecret_proof: proof,
            },
        });
        const page = response.data;
        const visible = pageId(page?.id) === pageId(expectedPageId);
        return {
            status: visible ? 'PASS' : 'FAIL',
            httpStatus: response.status || 200,
            expectedPageVisible: visible ? 'YES' : 'NO',
            pageTokenAvailable: fields.includes('access_token')
                ? (visible && hasNonEmptyAccessToken(page) ? 'YES' : 'NO')
                : 'NOT_REQUESTED',
            tasks: Array.isArray(page?.tasks)
                ? page.tasks.filter((task) => typeof task === 'string').sort()
                : [],
            graphError: visible ? null : {
                code: 'ID_MISMATCH',
                subcode: 'NONE',
                fbtraceId: 'NONE',
                classification: 'UNEXPECTED_PAGE_OBJECT',
            },
        };
    } catch (error) {
        const details = graphErrorDetails(error);
        return {
            status: 'FAIL',
            httpStatus: details.httpStatus,
            expectedPageVisible: 'NO',
            pageTokenAvailable: fields.includes('access_token') ? 'NO' : 'NOT_REQUESTED',
            tasks: [],
            graphError: {
                code: details.code,
                subcode: details.subcode,
                fbtraceId: details.fbtraceId,
                classification: graphErrorClassification(details.code, details.httpStatus),
            },
        };
    }
}

function printProgressiveProbe(label, result) {
    const error = result.graphError;
    line([
        `PROBE=${label}`,
        `status=${result.status}`,
        `http_status=${result.httpStatus}`,
        `page_visible=${result.expectedPageVisible}`,
        `page_token=${result.pageTokenAvailable}`,
        `graph_code=${error?.code || 'NONE'}`,
        `graph_subcode=${error?.subcode || 'NONE'}`,
        `error_class=${error?.classification || 'NONE'}`,
        `fbtrace_id=${error?.fbtraceId || 'NONE'}`,
    ].join(' '));
    line(`PROBE_TASKS=${JSON.stringify(result.tasks || [])} probe=${label}`);
}

/**
 * Run the progressive, read-only A/B probe without returning raw Graph data.
 * The request function is injectable so the complete sequence can be tested
 * without creating tokens or making live Graph calls.
 */
async function runProgressiveProbe({
    request = axios.get,
    graphBase = GRAPH_BASE,
    userToken,
    appId,
    appSecret,
    expectedPageId,
    businessId = null,
    configuration = 'UNSPECIFIED',
}) {
    const proof = appsecretProof(userToken, appSecret);
    const appAccessToken = `${appId}|${appSecret}`;
    let debugData;
    try {
        const response = await request(`${graphBase}/debug_token`, {
            params: {
                input_token: userToken,
                access_token: appAccessToken,
                appsecret_proof: appsecretProof(appAccessToken, appSecret),
            },
        });
        debugData = response.data?.data || {};
    } catch (error) {
        const details = graphErrorDetails(error);
        return {
            configuration,
            status: 'FAIL',
            debugToken: {
                status: 'FAIL',
                httpStatus: details.httpStatus,
                graphError: {
                    code: details.code,
                    subcode: details.subcode,
                    fbtraceId: details.fbtraceId,
                    classification: graphErrorClassification(details.code, details.httpStatus),
                },
            },
            probes: {},
        };
    }

    const scopeEvidence = safeScopeEvidence(debugData, appId, expectedPageId);
    const commonParams = {
        access_token: userToken,
        appsecret_proof: proof,
        limit: 100,
    };
    const probes = {};
    const collectionDefinitions = [
        ['meAccountsMinimal', MINIMAL_PAGE_FIELDS, false],
        ['meAccountsWithPageToken', PAGE_TOKEN_FIELDS, true],
        ['meAccountsRich', PAGE_FIELDS, true],
    ];
    for (const [label, fields, tokenRequested] of collectionDefinitions) {
        probes[label] = await requestCollection({
            request,
            url: `${graphBase}/me/accounts`,
            params: { ...commonParams, fields },
            expectedPageId,
            tokenRequested,
        });
    }

    const pageDefinitions = [
        ['directMinimal', MINIMAL_PAGE_FIELDS],
        ['directWithPageToken', PAGE_TOKEN_FIELDS],
        ['directRich', PAGE_HYDRATION_FIELDS],
    ];
    for (const [label, fields] of pageDefinitions) {
        probes[label] = await requestPage({
            request,
            url: `${graphBase}/${encodeURIComponent(expectedPageId)}`,
            fields,
            userToken,
            proof,
            expectedPageId,
        });
    }

    if (scopeEvidence.businessManagementGranted === 'YES' && businessId) {
        probes.businessOwnedPages = await requestCollection({
            request,
            url: `${graphBase}/${encodeURIComponent(businessId)}/owned_pages`,
            params: { ...commonParams, fields: MINIMAL_PAGE_FIELDS },
            expectedPageId,
            tokenRequested: false,
        });
    } else {
        probes.businessOwnedPages = {
            status: 'SKIPPED',
            reason: scopeEvidence.businessManagementGranted !== 'YES'
                ? 'BUSINESS_MANAGEMENT_NOT_GRANTED'
                : 'BUSINESS_ID_MISSING',
        };
    }

    const failedProbe = Object.values(probes).some((probe) => probe.status === 'FAIL');
    return {
        configuration,
        status: failedProbe ? 'FAIL' : 'PASS',
        debugToken: {
            status: 'PASS',
            tokenValid: scopeEvidence.tokenValid,
            tokenAppIdMatches: scopeEvidence.tokenAppIdMatches,
            tokenType: scopeEvidence.tokenType,
            grantedScopes: scopeEvidence.grantedScopes,
            businessManagementGranted: scopeEvidence.businessManagementGranted,
            granularTargets: scopeEvidence.granularTargets,
        },
        probes,
    };
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

function printProgressiveResult(result) {
    line(`CONFIGURATION=${result.configuration}`);
    line(`PROGRESSIVE_PROBE_STATUS=${result.status}`);
    if (result.debugToken?.status === 'FAIL') {
        const error = result.debugToken.graphError;
        line([
            'DEBUG_TOKEN=FAIL',
            `http_status=${result.debugToken.httpStatus}`,
            `graph_code=${error?.code || 'NONE'}`,
            `graph_subcode=${error?.subcode || 'NONE'}`,
            `error_class=${error?.classification || 'NONE'}`,
            `fbtrace_id=${error?.fbtraceId || 'NONE'}`,
        ].join(' '));
        return;
    }

    line(`TOKEN_VALID=${result.debugToken.tokenValid}`);
    line(`TOKEN_APP_ID_MATCH=${result.debugToken.tokenAppIdMatches}`);
    line(`TOKEN_TYPE=${result.debugToken.tokenType}`);
    line(`GRANTED_SCOPES=${JSON.stringify(result.debugToken.grantedScopes)}`);
    line(`BUSINESS_MANAGEMENT_GRANTED=${result.debugToken.businessManagementGranted}`);
    for (const [scope, evidence] of Object.entries(result.debugToken.granularTargets)) {
        line(`GRANULAR_TARGET scope=${scope} granted=${evidence.granted} expected_page=${evidence.expectedPage}`);
    }

    for (const [label, probe] of Object.entries(result.probes)) {
        if (probe.status === 'SKIPPED') {
            line(`PROBE=${label} status=SKIPPED reason=${probe.reason}`);
            continue;
        }
        printProgressiveProbe(label, probe);
    }
}

async function progressiveMain() {
    const userToken = USER_TOKEN_ENV_NAMES
        .map((name) => process.env[name])
        .find((value) => typeof value === 'string' && value.trim().length > 0);
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const expectedPageId = process.env.META_PAGE_DISCOVERY_PAGE_ID || process.env.META_PROBE_PAGE_ID;
    const businessId = process.env.META_PAGE_DISCOVERY_BUSINESS_ID || process.env.META_PROBE_BUSINESS_ID || null;
    const configuration = process.env.META_PAGE_DISCOVERY_CONFIGURATION || 'UNSPECIFIED';

    if (!userToken || !appId || !appSecret || !expectedPageId) {
        line('PROGRESSIVE_PROBE_STATUS=FAIL reason=MISSING_ENV');
        line('REQUIRED_ENV=META_PAGE_DISCOVERY_USER_TOKEN,META_APP_ID,META_APP_SECRET,META_PAGE_DISCOVERY_PAGE_ID');
        process.exitCode = 1;
        return;
    }

    const result = await runProgressiveProbe({
        userToken,
        appId,
        appSecret,
        expectedPageId,
        businessId,
        configuration,
    });
    printProgressiveResult(result);
    if (result.status === 'FAIL') process.exitCode = 1;
}

if (require.main === module) {
    const runner = process.env.META_PAGE_DISCOVERY_PROGRESSIVE === 'true'
        ? progressiveMain
        : main;
    runner().catch(() => {
        // Do not print an arbitrary exception: request/config details can carry
        // credentials. The per-call paths above already emit safe diagnostics.
        line('PROBE_STATUS=FAIL reason=UNEXPECTED_PROBE_FAILURE');
        process.exitCode = 1;
    });
}

module.exports = {
    appsecretProof,
    graphErrorClassification,
    hasNonEmptyAccessToken,
    paginateGraphCollection,
    runProgressiveProbe,
    safeScopeEvidence,
    targetIdsForScope,
};
