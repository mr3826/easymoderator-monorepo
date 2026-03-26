/**
 * Role-Based Access Control (RBAC)
 *
 * Role hierarchy: OWNER > MANAGER > AGENT > READER
 *
 * Note: The existing UserShop entity uses lowercase role values
 * ('owner', 'admin', 'staff'). This module defines the canonical
 * RBAC roles for new features while remaining compatible with the
 * legacy values via the ROLE_ALIASES map.
 */

const ROLES = {
    OWNER: 'OWNER',
    MANAGER: 'MANAGER',
    AGENT: 'AGENT',
    READER: 'READER'
};

// Map legacy DB role values to canonical RBAC roles
const ROLE_ALIASES = {
    owner: ROLES.OWNER,
    admin: ROLES.MANAGER,
    staff: ROLES.AGENT,
    // Canonical values map to themselves
    OWNER: ROLES.OWNER,
    MANAGER: ROLES.MANAGER,
    AGENT: ROLES.AGENT,
    READER: ROLES.READER
};

const PERMISSIONS = {
    DELETE_SHOP:          [ROLES.OWNER],
    EDIT_PRODUCTS:        [ROLES.OWNER, ROLES.MANAGER],
    CREATE_ORDER:         [ROLES.OWNER, ROLES.MANAGER, ROLES.AGENT],
    VIEW_ANALYTICS:       [ROLES.OWNER, ROLES.MANAGER],
    REPLY_CONVERSATION:   [ROLES.OWNER, ROLES.MANAGER, ROLES.AGENT],
    VIEW_ONLY:            [ROLES.OWNER, ROLES.MANAGER, ROLES.AGENT, ROLES.READER]
};

/**
 * Normalise a role string (handles legacy lowercase values).
 * @param {string} role
 * @returns {string} canonical RBAC role (OWNER | MANAGER | AGENT | READER)
 */
const normalizeRole = (role) => ROLE_ALIASES[role] || role;

/**
 * Check if a user role has a given permission.
 *
 * @param {string} userRole   - Role string (canonical or legacy alias)
 * @param {string} permission - One of the keys in PERMISSIONS
 * @returns {boolean}
 */
const hasPermission = (userRole, permission) => {
    const canonicalRole = normalizeRole(userRole);
    const allowed = PERMISSIONS[permission];
    if (!allowed) return false;
    return allowed.includes(canonicalRole);
};

/**
 * Express middleware factory.
 * Attaches to routes that require a specific permission.
 * Expects req.user.role to be set (either by authenticate middleware or a
 * shop-scoped middleware that sets it from UserShop).
 *
 * @param {string} permission - One of the keys in PERMISSIONS
 * @returns {Function} Express middleware
 */
const requirePermission = (permission) => {
    return (req, res, next) => {
        const role = req.user?.role;
        if (!role) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'No role assigned for this shop.' }
            });
        }
        if (!hasPermission(role, permission)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: `Permission denied. Required: ${permission}. Your role: ${role}.`
                }
            });
        }
        next();
    };
};

module.exports = { ROLES, PERMISSIONS, normalizeRole, hasPermission, requirePermission };
