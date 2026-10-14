'use strict';

/**
 * The authorization shape returned by Meta's debug_token endpoint is not a
 * set of Page IDs. When a permission applies to every current and future
 * asset, Meta omits target_ids altogether. Keep that state explicit so an
 * empty collection can never be mistaken for an all-assets grant.
 */

const PAGE_GRANT_MODE = Object.freeze({
    EXPLICIT: 'EXPLICIT',
    ALL: 'ALL',
    NONE: 'NONE',
    UNKNOWN: 'UNKNOWN',
});

const PAGE_GRANT_SCOPES = Object.freeze([
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
]);

function createGrant(mode, pageIds = [], reason = null) {
    return {
        mode,
        pageIds: new Set(pageIds),
        reason,
    };
}

function normalizePageId(value) {
    if (typeof value === 'string') {
        const candidate = value.trim();
        return candidate || null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return String(value);
    }
    return null;
}

function debugTokenValidation(debugData, expectedAppId) {
    if (debugData?.is_valid !== true) {
        return { valid: false, reason: 'TOKEN_INVALID' };
    }

    const configuredAppId = String(expectedAppId ?? '').trim();
    if (!configuredAppId) {
        return { valid: false, reason: 'EXPECTED_APP_ID_UNAVAILABLE' };
    }

    if (String(debugData?.app_id ?? '').trim() !== configuredAppId) {
        return { valid: false, reason: 'APP_ID_MISMATCH' };
    }

    return { valid: true, reason: null };
}

function granularEntryForScope(debugData, scope) {
    const granularScopes = Array.isArray(debugData?.granular_scopes)
        ? debugData.granular_scopes
        : null;
    if (!granularScopes) return { entry: null, reason: 'GRANULAR_SCOPES_MISSING' };

    const matches = granularScopes.filter((candidate) => candidate?.scope === scope);
    if (matches.length === 0) return { entry: null, reason: 'GRANULAR_ENTRY_MISSING' };
    if (matches.length !== 1) return { entry: null, reason: 'GRANULAR_ENTRY_AMBIGUOUS' };
    return { entry: matches[0], reason: null };
}

/**
 * Interpret one Meta granular permission without making an authorization
 * decision about a particular Page.
 *
 * Meta documents omitted target_ids as the all-assets representation. An
 * explicitly empty array, null, malformed IDs, a missing granular entry, or
 * a scope/entry mismatch is deliberately treated as UNKNOWN instead of ALL.
 *
 * @param {object} debugData
 * @param {string} scope
 * @param {{ expectedAppId: string }} options
 * @returns {{ mode: string, pageIds: Set<string>, reason: string|null }}
 */
function interpretPageGrant(debugData, scope, { expectedAppId } = {}) {
    const token = debugTokenValidation(debugData, expectedAppId);
    if (!token.valid) return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], token.reason);

    if (!Array.isArray(debugData.scopes)) {
        return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'SCOPES_MISSING');
    }

    const scopeGranted = debugData.scopes.includes(scope);
    const { entry, reason: entryReason } = granularEntryForScope(debugData, scope);
    if (!scopeGranted && !entry) return createGrant(PAGE_GRANT_MODE.NONE, [], 'PERMISSION_NOT_GRANTED');
    if (!scopeGranted && entry) {
        return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'SCOPE_ENTRY_MISMATCH');
    }
    if (!entry) return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], entryReason);

    // Meta's documented all-assets shape omits target_ids rather than
    // returning an empty list. Do not broaden this to null or other types.
    if (!Object.prototype.hasOwnProperty.call(entry, 'target_ids')) {
        return createGrant(PAGE_GRANT_MODE.ALL);
    }

    if (!Array.isArray(entry.target_ids)) {
        return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'TARGET_IDS_MALFORMED');
    }
    if (entry.target_ids.length === 0) {
        return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'TARGET_IDS_EMPTY');
    }

    const pageIds = [];
    for (const rawPageId of entry.target_ids) {
        const pageId = normalizePageId(rawPageId);
        if (!pageId) return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'TARGET_IDS_MALFORMED');
        pageIds.push(pageId);
    }

    return createGrant(PAGE_GRANT_MODE.EXPLICIT, pageIds);
}

function interpretPageGrants(debugData, expectedAppId) {
    return Object.fromEntries(
        PAGE_GRANT_SCOPES.map((scope) => [
            scope,
            interpretPageGrant(debugData, scope, { expectedAppId }),
        ]),
    );
}

function cloneGrant(grant) {
    return createGrant(grant?.mode || PAGE_GRANT_MODE.UNKNOWN, grant?.pageIds || [], grant?.reason || null);
}

/**
 * Combine two permissions that are both required for a Page connection.
 * Unknown data never widens the result, and explicit grants intersect.
 */
function intersectPageGrants(left, right) {
    if (!left || !right) return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'GRANT_MISSING');
    if (left.mode === PAGE_GRANT_MODE.NONE || right.mode === PAGE_GRANT_MODE.NONE) {
        return createGrant(PAGE_GRANT_MODE.NONE, [], 'REQUIRED_PERMISSION_MISSING');
    }
    if (left.mode === PAGE_GRANT_MODE.UNKNOWN || right.mode === PAGE_GRANT_MODE.UNKNOWN) {
        return createGrant(PAGE_GRANT_MODE.UNKNOWN, [], 'REQUIRED_PERMISSION_AMBIGUOUS');
    }
    if (left.mode === PAGE_GRANT_MODE.ALL && right.mode === PAGE_GRANT_MODE.ALL) {
        return createGrant(PAGE_GRANT_MODE.ALL);
    }
    if (left.mode === PAGE_GRANT_MODE.ALL) return cloneGrant(right);
    if (right.mode === PAGE_GRANT_MODE.ALL) return cloneGrant(left);

    return createGrant(
        PAGE_GRANT_MODE.EXPLICIT,
        [...left.pageIds].filter((pageId) => right.pageIds.has(pageId)),
    );
}

function grantAllowsPage(grant, pageId) {
    const normalizedPageId = normalizePageId(pageId);
    if (!normalizedPageId) return false;
    if (grant?.mode === PAGE_GRANT_MODE.ALL) return true;
    return grant?.mode === PAGE_GRANT_MODE.EXPLICIT && grant.pageIds.has(normalizedPageId);
}

function grantCanAuthorizePages(grant) {
    return grant?.mode === PAGE_GRANT_MODE.ALL || grant?.mode === PAGE_GRANT_MODE.EXPLICIT;
}

module.exports = {
    PAGE_GRANT_MODE,
    PAGE_GRANT_SCOPES,
    createGrant,
    debugTokenValidation,
    interpretPageGrant,
    interpretPageGrants,
    intersectPageGrants,
    grantAllowsPage,
    grantCanAuthorizePages,
    normalizePageId,
};
