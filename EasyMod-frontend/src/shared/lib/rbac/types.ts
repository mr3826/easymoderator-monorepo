/**
 * RBAC (Role-Based Access Control) types and permission definitions
 * 
 * Defines all roles, permissions, and the role→permission mapping
 * Matches backend roles defined in [backend]/src/modules/user/user.entity.js
 */

/**
 * User roles in the system
 * Maps to UserRole enum in backend
 */
export enum UserRole {
  ADMIN = 'ADMIN',           // Full system access
  MODERATOR = 'MODERATOR',   // Access to moderation, conversations, templates
  REVIEWER = 'REVIEWER',     // Read-only access to analytics, reports
  USER = 'USER',             // Basic user (team member, shop staff)
}

/**
 * Shop-level roles (for multi-shop users)
 * Not in global user record, but in user_shop join table
 */
export enum ShopRole {
  OWNER = 'OWNER',           // Full shop access
  MANAGER = 'MANAGER',       // Can edit settings, manage team
  STAFF = 'STAFF',           // Limited access (view only or specific features)
}

/**
 * Granular permission strings
 * Format: "action:resource"
 * 
 * These are checked by useUserPermissions().can(action, resource)
 */
export enum Permission {
  // User management
  READ_USERS = 'read:users',
  WRITE_USERS = 'write:users',
  DELETE_USERS = 'delete:users',
  MANAGE_ROLES = 'manage:roles',

  // Shop management
  READ_SHOP = 'read:shop',
  WRITE_SHOP = 'write:shop',
  MANAGE_TEAM = 'manage:team',

  // Products
  READ_PRODUCTS = 'read:products',
  WRITE_PRODUCTS = 'write:products',
  DELETE_PRODUCTS = 'delete:products',
  BULK_IMPORT_PRODUCTS = 'bulk_import:products',

  // Orders
  READ_ORDERS = 'read:orders',
  WRITE_ORDERS = 'write:orders',
  UPDATE_ORDER_STATUS = 'update_status:orders',
  EXPORT_ORDERS = 'export:orders',

  // Conversations
  READ_CONVERSATIONS = 'read:conversations',
  WRITE_CONVERSATIONS = 'write:conversations',
  ASSIGN_CONVERSATIONS = 'assign:conversations',
  MANAGE_TEMPLATES = 'manage:templates',

  // Analytics & Reporting
  READ_ANALYTICS = 'read:analytics',
  READ_REPORTS = 'read:reports',
  EXPORT_REPORTS = 'export:reports',

  // Knowledge Base
  READ_KNOWLEDGE = 'read:knowledge',
  WRITE_KNOWLEDGE = 'write:knowledge',
  DELETE_KNOWLEDGE = 'delete:knowledge',

  // Settings & Configuration
  READ_SETTINGS = 'read:settings',
  WRITE_SETTINGS = 'write:settings',
  MANAGE_INTEGRATIONS = 'manage:integrations',
  MANAGE_WEBHOOKS = 'manage:webhooks',

  // Subscription & Billing
  READ_SUBSCRIPTION = 'read:subscription',
  MANAGE_SUBSCRIPTION = 'manage:subscription',

  // Admin panel
  ACCESS_ADMIN_PANEL = 'access:admin_panel',
  VIEW_AUDIT_LOGS = 'view:audit_logs',
  MANAGE_API_KEYS = 'manage:api_keys',

  // Development/Advanced
  DEBUG_REQUESTS = 'debug:requests',
}

/**
 * Permission matrix: which roles have which permissions
 * Apply most restrictive first (ADMIN → USER)
 */
export const PERMISSION_MATRIX: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    // Admin has everything
    Permission.READ_USERS,
    Permission.WRITE_USERS,
    Permission.DELETE_USERS,
    Permission.MANAGE_ROLES,
    Permission.READ_SHOP,
    Permission.WRITE_SHOP,
    Permission.MANAGE_TEAM,
    Permission.READ_PRODUCTS,
    Permission.WRITE_PRODUCTS,
    Permission.DELETE_PRODUCTS,
    Permission.BULK_IMPORT_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.WRITE_ORDERS,
    Permission.UPDATE_ORDER_STATUS,
    Permission.EXPORT_ORDERS,
    Permission.READ_CONVERSATIONS,
    Permission.WRITE_CONVERSATIONS,
    Permission.ASSIGN_CONVERSATIONS,
    Permission.MANAGE_TEMPLATES,
    Permission.READ_ANALYTICS,
    Permission.READ_REPORTS,
    Permission.EXPORT_REPORTS,
    Permission.READ_KNOWLEDGE,
    Permission.WRITE_KNOWLEDGE,
    Permission.DELETE_KNOWLEDGE,
    Permission.READ_SETTINGS,
    Permission.WRITE_SETTINGS,
    Permission.MANAGE_INTEGRATIONS,
    Permission.MANAGE_WEBHOOKS,
    Permission.READ_SUBSCRIPTION,
    Permission.MANAGE_SUBSCRIPTION,
    Permission.ACCESS_ADMIN_PANEL,
    Permission.VIEW_AUDIT_LOGS,
    Permission.MANAGE_API_KEYS,
    Permission.DEBUG_REQUESTS,
  ],

  [UserRole.MODERATOR]: [
    // Moderator manages conversations, templates, and some reports
    Permission.READ_USERS,           // View users but not edit
    Permission.READ_SHOP,
    Permission.READ_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.WRITE_ORDERS,         // Can update order comments/notes
    Permission.READ_CONVERSATIONS,
    Permission.WRITE_CONVERSATIONS,  // Can reply in conversations
    Permission.ASSIGN_CONVERSATIONS,
    Permission.MANAGE_TEMPLATES,
    Permission.READ_ANALYTICS,       // Basic analytics
    Permission.READ_REPORTS,
    Permission.READ_KNOWLEDGE,
    Permission.WRITE_KNOWLEDGE,      // Can add FAQ/help articles
    Permission.READ_SETTINGS,
    Permission.MANAGE_INTEGRATIONS,  // Can connect channels
  ],

  [UserRole.REVIEWER]: [
    // Reviewer has read-only access to analytics and reports
    Permission.READ_SHOP,
    Permission.READ_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.READ_CONVERSATIONS,   // Read-only
    Permission.READ_ANALYTICS,
    Permission.READ_REPORTS,
    Permission.EXPORT_REPORTS,
    Permission.READ_KNOWLEDGE,
    Permission.READ_SETTINGS,
    Permission.READ_SUBSCRIPTION,
  ],

  [UserRole.USER]: [
    // Basic user - limited shop staff access
    Permission.READ_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.READ_CONVERSATIONS,   // Read-only
    Permission.READ_SHOP,
    Permission.READ_SUBSCRIPTION,
  ],
};

/**
 * Shop-level permissions for multi-shop tenants
 * Applied ON TOP OF global permissions (more restrictive wins)
 */
export const SHOP_PERMISSION_MATRIX: Record<ShopRole, Permission[]> = {
  [ShopRole.OWNER]: [
    // Shop owner can manage everything in their shop
    Permission.READ_SHOP,
    Permission.WRITE_SHOP,
    Permission.MANAGE_TEAM,
    Permission.READ_PRODUCTS,
    Permission.WRITE_PRODUCTS,
    Permission.DELETE_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.WRITE_ORDERS,
    Permission.UPDATE_ORDER_STATUS,
    Permission.EXPORT_ORDERS,
    Permission.READ_CONVERSATIONS,
    Permission.WRITE_CONVERSATIONS,
    Permission.ASSIGN_CONVERSATIONS,
    Permission.MANAGE_TEMPLATES,
    Permission.READ_ANALYTICS,
    Permission.READ_REPORTS,
    Permission.EXPORT_REPORTS,
    Permission.READ_KNOWLEDGE,
    Permission.WRITE_KNOWLEDGE,
    Permission.READ_SETTINGS,
    Permission.WRITE_SETTINGS,
    Permission.MANAGE_INTEGRATIONS,
    Permission.MANAGE_WEBHOOKS,
    Permission.READ_SUBSCRIPTION,
    Permission.MANAGE_SUBSCRIPTION,
  ],

  [ShopRole.MANAGER]: [
    // Manager can manage team and settings
    Permission.READ_SHOP,
    Permission.WRITE_SHOP,
    Permission.MANAGE_TEAM,
    Permission.READ_PRODUCTS,
    Permission.WRITE_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.WRITE_ORDERS,
    Permission.READ_CONVERSATIONS,
    Permission.WRITE_CONVERSATIONS,
    Permission.ASSIGN_CONVERSATIONS,
    Permission.MANAGE_TEMPLATES,
    Permission.READ_ANALYTICS,
    Permission.READ_REPORTS,
    Permission.READ_KNOWLEDGE,
    Permission.WRITE_KNOWLEDGE,
    Permission.READ_SETTINGS,
    Permission.WRITE_SETTINGS,
  ],

  [ShopRole.STAFF]: [
    // Staff can view/action on day-to-day operations
    Permission.READ_SHOP,
    Permission.READ_PRODUCTS,
    Permission.READ_ORDERS,
    Permission.WRITE_ORDERS,
    Permission.READ_CONVERSATIONS,
    Permission.WRITE_CONVERSATIONS,
    Permission.READ_ANALYTICS,
    Permission.READ_REPORTS,
  ],
};
