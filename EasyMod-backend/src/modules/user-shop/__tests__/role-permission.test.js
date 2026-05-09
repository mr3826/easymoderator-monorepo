'use strict';

const {
    ROLES,
    PERMISSIONS,
    normalizeRole,
    hasPermission,
    requirePermission,
} = require('../role-permission');

// ─── ROLES constant ───────────────────────────────────────────────────────────

describe('ROLES', () => {
    test('exports the four canonical role strings', () => {
        expect(ROLES.OWNER).toBe('OWNER');
        expect(ROLES.MANAGER).toBe('MANAGER');
        expect(ROLES.AGENT).toBe('AGENT');
        expect(ROLES.READER).toBe('READER');
    });
});

// ─── PERMISSIONS constant ─────────────────────────────────────────────────────

describe('PERMISSIONS', () => {
    test('DELETE_SHOP is restricted to OWNER only', () => {
        expect(PERMISSIONS.DELETE_SHOP).toEqual([ROLES.OWNER]);
    });

    test('EDIT_PRODUCTS includes OWNER and MANAGER', () => {
        expect(PERMISSIONS.EDIT_PRODUCTS).toContain(ROLES.OWNER);
        expect(PERMISSIONS.EDIT_PRODUCTS).toContain(ROLES.MANAGER);
        expect(PERMISSIONS.EDIT_PRODUCTS).not.toContain(ROLES.AGENT);
        expect(PERMISSIONS.EDIT_PRODUCTS).not.toContain(ROLES.READER);
    });

    test('CREATE_ORDER includes OWNER, MANAGER and AGENT — not READER', () => {
        expect(PERMISSIONS.CREATE_ORDER).toContain(ROLES.OWNER);
        expect(PERMISSIONS.CREATE_ORDER).toContain(ROLES.MANAGER);
        expect(PERMISSIONS.CREATE_ORDER).toContain(ROLES.AGENT);
        expect(PERMISSIONS.CREATE_ORDER).not.toContain(ROLES.READER);
    });

    test('VIEW_ONLY includes all four roles', () => {
        expect(PERMISSIONS.VIEW_ONLY).toContain(ROLES.OWNER);
        expect(PERMISSIONS.VIEW_ONLY).toContain(ROLES.MANAGER);
        expect(PERMISSIONS.VIEW_ONLY).toContain(ROLES.AGENT);
        expect(PERMISSIONS.VIEW_ONLY).toContain(ROLES.READER);
    });
});

// ─── normalizeRole() ──────────────────────────────────────────────────────────

describe('normalizeRole()', () => {
    test('"owner" → "OWNER"', () => {
        expect(normalizeRole('owner')).toBe('OWNER');
    });

    test('"admin" → "MANAGER"', () => {
        expect(normalizeRole('admin')).toBe('MANAGER');
    });

    test('"staff" → "AGENT"', () => {
        expect(normalizeRole('staff')).toBe('AGENT');
    });

    test('"OWNER" (already canonical) → "OWNER"', () => {
        expect(normalizeRole('OWNER')).toBe('OWNER');
    });

    test('"MANAGER" (already canonical) → "MANAGER"', () => {
        expect(normalizeRole('MANAGER')).toBe('MANAGER');
    });

    test('"AGENT" (already canonical) → "AGENT"', () => {
        expect(normalizeRole('AGENT')).toBe('AGENT');
    });

    test('"READER" (already canonical) → "READER"', () => {
        expect(normalizeRole('READER')).toBe('READER');
    });

    test('unknown role string returned unchanged', () => {
        expect(normalizeRole('superadmin')).toBe('superadmin');
        expect(normalizeRole('guest')).toBe('guest');
    });
});

// ─── hasPermission() ──────────────────────────────────────────────────────────

describe('hasPermission() — canonical roles', () => {
    test('OWNER has DELETE_SHOP', () => {
        expect(hasPermission(ROLES.OWNER, 'DELETE_SHOP')).toBe(true);
    });

    test('MANAGER does not have DELETE_SHOP', () => {
        expect(hasPermission(ROLES.MANAGER, 'DELETE_SHOP')).toBe(false);
    });

    test('AGENT does not have DELETE_SHOP', () => {
        expect(hasPermission(ROLES.AGENT, 'DELETE_SHOP')).toBe(false);
    });

    test('READER does not have DELETE_SHOP', () => {
        expect(hasPermission(ROLES.READER, 'DELETE_SHOP')).toBe(false);
    });

    test('OWNER has EDIT_PRODUCTS', () => {
        expect(hasPermission(ROLES.OWNER, 'EDIT_PRODUCTS')).toBe(true);
    });

    test('MANAGER has EDIT_PRODUCTS', () => {
        expect(hasPermission(ROLES.MANAGER, 'EDIT_PRODUCTS')).toBe(true);
    });

    test('AGENT does not have EDIT_PRODUCTS', () => {
        expect(hasPermission(ROLES.AGENT, 'EDIT_PRODUCTS')).toBe(false);
    });

    test('OWNER, MANAGER, AGENT all have CREATE_ORDER', () => {
        expect(hasPermission(ROLES.OWNER, 'CREATE_ORDER')).toBe(true);
        expect(hasPermission(ROLES.MANAGER, 'CREATE_ORDER')).toBe(true);
        expect(hasPermission(ROLES.AGENT, 'CREATE_ORDER')).toBe(true);
    });

    test('READER does not have CREATE_ORDER', () => {
        expect(hasPermission(ROLES.READER, 'CREATE_ORDER')).toBe(false);
    });

    test('all roles have VIEW_ONLY', () => {
        expect(hasPermission(ROLES.OWNER, 'VIEW_ONLY')).toBe(true);
        expect(hasPermission(ROLES.MANAGER, 'VIEW_ONLY')).toBe(true);
        expect(hasPermission(ROLES.AGENT, 'VIEW_ONLY')).toBe(true);
        expect(hasPermission(ROLES.READER, 'VIEW_ONLY')).toBe(true);
    });

    test('unknown permission → false', () => {
        expect(hasPermission(ROLES.OWNER, 'NONEXISTENT_PERM')).toBe(false);
    });
});

describe('hasPermission() — legacy aliases', () => {
    test('"owner" (legacy) has DELETE_SHOP', () => {
        expect(hasPermission('owner', 'DELETE_SHOP')).toBe(true);
    });

    test('"admin" (legacy) has EDIT_PRODUCTS', () => {
        expect(hasPermission('admin', 'EDIT_PRODUCTS')).toBe(true);
    });

    test('"admin" (legacy) does not have DELETE_SHOP', () => {
        expect(hasPermission('admin', 'DELETE_SHOP')).toBe(false);
    });

    test('"staff" (legacy) has CREATE_ORDER', () => {
        expect(hasPermission('staff', 'CREATE_ORDER')).toBe(true);
    });

    test('"staff" (legacy) does not have EDIT_PRODUCTS', () => {
        expect(hasPermission('staff', 'EDIT_PRODUCTS')).toBe(false);
    });

    test('"staff" (legacy) has VIEW_ONLY', () => {
        expect(hasPermission('staff', 'VIEW_ONLY')).toBe(true);
    });
});

// ─── requirePermission() middleware ───────────────────────────────────────────

describe('requirePermission() middleware', () => {
    const makeResMock = () => {
        const json = jest.fn();
        const status = jest.fn(() => ({ json }));
        return { status, json: json.mock };
    };

    test('no role on req.user → 403 FORBIDDEN response', () => {
        const middleware = requirePermission('DELETE_SHOP');
        const req = { user: {} };
        const { status } = makeResMock();
        const res = { status };
        const next = jest.fn();

        middleware(req, res, next);

        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('req.user is undefined → 403 FORBIDDEN response', () => {
        const middleware = requirePermission('DELETE_SHOP');
        const req = {};
        const { status } = makeResMock();
        const res = { status };
        const next = jest.fn();

        middleware(req, res, next);

        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('role that lacks the permission → 403', () => {
        const middleware = requirePermission('DELETE_SHOP');
        const req = { user: { role: 'MANAGER' } };
        const { status } = makeResMock();
        const res = { status };
        const next = jest.fn();

        middleware(req, res, next);

        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('correct canonical role → calls next()', () => {
        const middleware = requirePermission('DELETE_SHOP');
        const req = { user: { role: 'OWNER' } };
        const res = {};
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(); // no error argument
    });

    test('legacy alias role that has the permission → calls next()', () => {
        const middleware = requirePermission('EDIT_PRODUCTS');
        const req = { user: { role: 'admin' } }; // legacy alias for MANAGER
        const res = {};
        const next = jest.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    test('403 response body contains FORBIDDEN code', () => {
        const middleware = requirePermission('DELETE_SHOP');
        const req = { user: { role: 'AGENT' } };

        let capturedBody;
        const json = jest.fn(body => { capturedBody = body; });
        const status = jest.fn(() => ({ json }));
        const res = { status };
        const next = jest.fn();

        middleware(req, res, next);

        expect(status).toHaveBeenCalledWith(403);
        expect(capturedBody).toMatchObject({
            success: false,
            error: { code: 'FORBIDDEN' }
        });
    });

    test('missing role 403 body has "No role assigned" message', () => {
        const middleware = requirePermission('VIEW_ONLY');
        const req = { user: {} };

        let capturedBody;
        const json = jest.fn(body => { capturedBody = body; });
        const status = jest.fn(() => ({ json }));
        const res = { status };
        const next = jest.fn();

        middleware(req, res, next);

        expect(capturedBody.error.message).toMatch(/no role/i);
    });
});
