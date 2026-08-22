const User = require('./user/user.entity');
const Tenant = require('./tenant/tenant.entity');
const Shop = require('./shop/shop.entity');
const UserShop = require('./user-shop/user-shop.entity');
const Session = require('./auth/session.entity');
const PasswordResetToken = require('./auth/password-reset-token.entity');
const Category = require('./category/category.entity');
const Product = require('./product/product.entity');
// Bug #5: relational variant table (replaces flat JSON array in Product.variants)
const ProductVariant = require('./product/product-variant.entity');
const Customer = require('./customer/customer.entity');
const Order = require('./order/order.entity');
const OrderReturn = require('./order/order-return.entity');
const OrderItem = require('./order/order-item.entity');
const { Conversation, Message } = require('./conversation/conversation.entity');
const AuditLog = require('./audit/audit-log.entity');
const IdempotencyKey = require('./audit/idempotency-key.entity');
const DeliveryIntegration = require('./delivery/delivery-integration.entity');
const DeliveryCost = require('./delivery/delivery-cost.entity');
const KnownArea = require('./delivery/known-area.entity');
const PaymentConfig = require('./payment/payment-config.entity');
const Subscription = require('./subscription/subscription.entity');
const Invoice = require('./subscription/invoice.entity');
const PartnerApplication = require('./subscription/partner-application.entity');
const UsageEvent = require('./subscription/usage-event.entity');
const Keyword = require('./keyword/keyword.entity');
const FaqResponse = require('./knowledge/faq-response.entity');
const BanglishDictionary = require('./language/banglish-dictionary.entity');
const Analytics = require('./analytics/analytics.entity');
const KnowledgeGap = require('./analytics/knowledge-gap.entity');
const SupportTicket = require('./support/support-ticket.entity');
const ResponseTemplate = require('./template/response-template.entity');
const CustomerPreference = require('./customer/customer-preference.entity');
const TrxIDLog = require('./payment/trx-id-log.entity');
const PaymentTransaction = require('./billing/payment-transaction.entity');
const OwnerNotification = require('./notification/owner-notification.entity');
const OrderInvoice = require('./billing/invoice.entity');
const DeliveryTracking = require('./order/delivery-tracking.entity');
const PushSubscription = require('./notification/push-subscription.entity');
const TelegramNotificationBinding = require('./notification/telegram-notification-binding.entity');
const CustomerDeliveryStats = require('./rto-shield/customer-delivery-stats.entity');
const CourierCodCollection = require('./reconciliation/courier-collection.entity');
const ReconciliationDispute = require('./reconciliation/reconciliation-dispute.entity');
const GrowthOsUserRole = require('./growth-os/growth-os-user-role.entity');

let growthOsProspect;
let growthOsProspectEvent;
let growthOsProspectAssociationsReady = false;

function loadGrowthOsProspectEntities() {
    if (!growthOsProspect) {
        growthOsProspect = require('./growth-os/growth-os-prospect.entity');
        growthOsProspectEvent = require('./growth-os/growth-os-prospect-event.entity');
    }

    if (!growthOsProspectAssociationsReady) {
        growthOsProspect.belongsTo(User, { foreignKey: 'owner_user_id', as: 'ownerUser' });
        growthOsProspect.belongsTo(User, { foreignKey: 'assigned_by', as: 'assignedBy' });
        growthOsProspect.belongsTo(User, { foreignKey: 'linked_user_id', as: 'linkedUser' });
        growthOsProspect.belongsTo(User, { foreignKey: 'created_by', as: 'createdBy' });
        growthOsProspect.belongsTo(Shop, { foreignKey: 'linked_shop_id', as: 'linkedShop' });
        growthOsProspect.belongsTo(growthOsProspect, { foreignKey: 'merged_into_id', as: 'mergedInto' });
        User.hasMany(growthOsProspect, { foreignKey: 'owner_user_id', as: 'ownedGrowthProspects' });
        User.hasMany(growthOsProspect, { foreignKey: 'assigned_by', as: 'assignedGrowthProspects' });
        User.hasMany(growthOsProspect, { foreignKey: 'linked_user_id', as: 'linkedGrowthProspects' });
        User.hasMany(growthOsProspect, { foreignKey: 'created_by', as: 'createdGrowthProspects' });
        Shop.hasMany(growthOsProspect, { foreignKey: 'linked_shop_id', as: 'growthOsProspects' });
        growthOsProspect.hasMany(growthOsProspect, { foreignKey: 'merged_into_id', as: 'mergedProspects' });
        growthOsProspect.hasMany(growthOsProspectEvent, {
            foreignKey: 'prospect_id',
            as: 'events',
            onDelete: 'CASCADE',
        });
        growthOsProspectEvent.belongsTo(growthOsProspect, { foreignKey: 'prospect_id', as: 'prospect' });
        growthOsProspectEvent.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });
        User.hasMany(growthOsProspectEvent, { foreignKey: 'actor_user_id', as: 'growthOsProspectEvents' });
        growthOsProspectAssociationsReady = true;
    }

    return { GrowthOsProspect: growthOsProspect, GrowthOsProspectEvent: growthOsProspectEvent };
}

// Phase 1 — Meta Integration Redesign: new unified channel entities
const MetaChannel = require('./channel-providers/meta-channel.entity');
const MetaChannelSettings = require('./channel-providers/meta-channel-settings.entity');
const MetaChannelConsentEvent = require('./channel-providers/meta-channel-consent-event.entity');
const MetaUserIdentity = require('./channel-providers/meta-user-identity.entity');
const MetaDataDeletionRequest = require('./integration/meta-data-deletion-request.entity');
const MetaWebhookReceipt = require('./integration/meta-webhook-receipt.entity');

// Phase 3 — Policy Engine audit log
const PolicyDecision = require('./policy/policy-decision.entity');

// Define many-to-many relationships
User.belongsToMany(Shop, {
    through: UserShop,
    foreignKey: 'user_id',
    otherKey: 'shop_id',
    as: 'shops'
});

Shop.belongsToMany(User, {
    through: UserShop,
    foreignKey: 'shop_id',
    otherKey: 'user_id',
    as: 'users'
});

// Define belongsTo relationships for UserShop
UserShop.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
UserShop.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });

// Define User-Session relationship
User.hasMany(Session, {
    foreignKey: 'user_id',
    as: 'sessions',
    onDelete: 'CASCADE'
});

Session.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

// Define Shop-Session relationship
Shop.hasMany(Session, {
    foreignKey: 'shop_id',
    as: 'sessions',
    onDelete: 'CASCADE'
});

Session.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Tenant-Shop relationship
Tenant.hasMany(Shop, {
    foreignKey: 'tenant_id',
    as: 'shops',
    onDelete: 'CASCADE'
});

Shop.belongsTo(Tenant, {
    foreignKey: 'tenant_id',
    as: 'tenant'
});

// Define Shop-Category relationship
Shop.hasMany(Category, {
    foreignKey: 'shop_id',
    as: 'categories',
    onDelete: 'CASCADE'
});

Category.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Category self-referencing relationships
Category.hasMany(Category, {
    foreignKey: 'parent_category_id',
    as: 'subcategories',
    onDelete: 'CASCADE'
});

Category.belongsTo(Category, {
    foreignKey: 'parent_category_id',
    as: 'parent_category'
});

// Define Shop-Product relationship
Shop.hasMany(Product, {
    foreignKey: 'shop_id',
    as: 'products',
    onDelete: 'CASCADE'
});

Product.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Category-Product relationship
Category.hasMany(Product, {
    foreignKey: 'category_id',
    as: 'products',
    onDelete: 'SET NULL'
});

Product.belongsTo(Category, {
    foreignKey: 'category_id',
    as: 'category_ref'
});

// Define Shop-Customer relationship
Shop.hasMany(Customer, {
    foreignKey: 'shop_id',
    as: 'customers',
    onDelete: 'CASCADE'
});

Customer.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Shop-Order relationship
Shop.hasMany(Order, {
    foreignKey: 'shop_id',
    as: 'orders',
    onDelete: 'CASCADE'
});

Order.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Customer-Order relationship
Customer.hasMany(Order, {
    foreignKey: 'customer_id',
    as: 'orders',
    onDelete: 'RESTRICT'
});

Order.belongsTo(Customer, {
    foreignKey: 'customer_id',
    as: 'customer'
});

// Define Order-Product (Many-to-Many through OrderItem)
Order.belongsToMany(Product, {
    through: OrderItem,
    foreignKey: 'order_id',
    otherKey: 'product_id',
    as: 'products'
});

Product.belongsToMany(Order, {
    through: OrderItem,
    foreignKey: 'product_id',
    otherKey: 'order_id',
    as: 'orders'
});

// Define Order-OrderItem (One-to-Many)
Order.hasMany(OrderItem, {
    foreignKey: 'order_id',
    as: 'order_items',
    onDelete: 'CASCADE'
});

OrderItem.belongsTo(Order, {
    foreignKey: 'order_id',
    as: 'order'
});

// Define Product-OrderItem (One-to-Many)
Product.hasMany(OrderItem, {
    foreignKey: 'product_id',
    as: 'order_items',
    onDelete: 'RESTRICT'
});

OrderItem.belongsTo(Product, {
    foreignKey: 'product_id',
    as: 'product'
});

// Define Shop-Conversation relationship
Shop.hasMany(Conversation, {
    foreignKey: 'shop_id',
    as: 'conversations',
    onDelete: 'CASCADE'
});

Conversation.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Define Customer-Conversation relationship
Customer.hasMany(Conversation, {
    foreignKey: 'customer_id',
    as: 'conversations',
    onDelete: 'SET NULL'
});

Conversation.belongsTo(Customer, {
    foreignKey: 'customer_id',
    as: 'customer'
});

// Define Conversation-Message relationship
Conversation.hasMany(Message, {
    foreignKey: 'conversation_id',
    as: 'messages',
    onDelete: 'CASCADE'
});

Message.belongsTo(Conversation, {
    foreignKey: 'conversation_id',
    as: 'conversation'
});

// Define audit log relationships
AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
AuditLog.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });

// Define Growth OS internal role relationships. These roles are separate from
// merchant user_shops roles and users.platform_role.
GrowthOsUserRole.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
GrowthOsUserRole.belongsTo(User, { foreignKey: 'granted_by', as: 'grantedBy' });
GrowthOsUserRole.belongsTo(User, { foreignKey: 'revoked_by', as: 'revokedBy' });
User.hasMany(GrowthOsUserRole, { foreignKey: 'user_id', as: 'growthOsRoles' });

// Define idempotency key relationships
IdempotencyKey.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
IdempotencyKey.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });

// Define delivery integration relationships
DeliveryIntegration.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(DeliveryIntegration, { foreignKey: 'shop_id', as: 'delivery_integrations' });

// Define delivery cost and areas
DeliveryCost.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(DeliveryCost, { foreignKey: 'shop_id', as: 'delivery_costs' });
KnownArea.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(KnownArea, { foreignKey: 'shop_id', as: 'known_areas' });

// Define payment config relationships
PaymentConfig.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(PaymentConfig, { foreignKey: 'shop_id', as: 'payment_configs' });

// Define subscription relationships
Subscription.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasOne(Subscription, { foreignKey: 'shop_id', as: 'subscription' });

// Partner application — shop_id is nullable (public applicants), so no FK constraint.
PartnerApplication.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop', constraints: false });

// Define invoice relationships
Invoice.belongsTo(Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
Invoice.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Subscription.hasMany(Invoice, { foreignKey: 'subscription_id', as: 'invoices' });
Shop.hasMany(Invoice, { foreignKey: 'shop_id', as: 'invoices' });

// Define usage event relationships
UsageEvent.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(UsageEvent, { foreignKey: 'shop_id', as: 'usage_events' });

// Define keyword and faq relationships
Keyword.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(Keyword, { foreignKey: 'shop_id', as: 'keywords' });
FaqResponse.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(FaqResponse, { foreignKey: 'shop_id', as: 'faq_responses' });

// Define analytics relationships
Analytics.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(Analytics, { foreignKey: 'shop_id', as: 'analytics' });

// Define knowledge gap relationships
KnowledgeGap.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(KnowledgeGap, { foreignKey: 'shop_id', as: 'knowledge_gaps' });

// Define support ticket relationships
SupportTicket.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(SupportTicket, { foreignKey: 'shop_id', as: 'support_tickets' });

// Define response template relationships
ResponseTemplate.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(ResponseTemplate, { foreignKey: 'shop_id', as: 'response_templates' });

// Define customer preference relationships
CustomerPreference.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
CustomerPreference.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });
Customer.hasOne(CustomerPreference, { foreignKey: 'customer_id', as: 'preference' });
Shop.hasMany(CustomerPreference, { foreignKey: 'shop_id', as: 'customer_preferences' });

// TrxIDLog — MFS payment screenshot audit trail
TrxIDLog.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
TrxIDLog.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Shop.hasMany(TrxIDLog, { foreignKey: 'shop_id', as: 'trx_logs' });
Order.hasMany(TrxIDLog, { foreignKey: 'order_id', as: 'trx_logs' });

// Payment Transaction relationships
PaymentTransaction.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
PaymentTransaction.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Shop.hasMany(PaymentTransaction, { foreignKey: 'shop_id', as: 'payment_transactions' });
Order.hasMany(PaymentTransaction, { foreignKey: 'order_id', as: 'payment_transactions' });

// Owner Notification relationships
OwnerNotification.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(OwnerNotification, { foreignKey: 'shop_id', as: 'owner_notifications' });

// Order Invoice relationships
OrderInvoice.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
OrderInvoice.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Shop.hasMany(OrderInvoice, { foreignKey: 'shop_id', as: 'order_invoices' });
Order.hasMany(OrderInvoice, { foreignKey: 'order_id', as: 'invoices' });

// Delivery Tracking relationships
DeliveryTracking.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Order.hasMany(DeliveryTracking, { foreignKey: 'order_id', as: 'delivery_tracking' });

// Push Subscription relationships
PushSubscription.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(PushSubscription, { foreignKey: 'shop_id', as: 'push_subscriptions' });

// Telegram Notification Binding relationships
TelegramNotificationBinding.belongsTo(Shop, { foreignKey: 'shop_id', as: 'telegram_notification_binding' });
Shop.hasOne(TelegramNotificationBinding, { foreignKey: 'shop_id', as: 'telegram_notification_binding' });

// ── Phase 1: MetaChannel associations ──────────────────────────────────────
// Shop <-> MetaChannel (one shop, many channels — one per platform)
Shop.hasMany(MetaChannel, {
    foreignKey: 'shop_id',
    as: 'metaChannels',
    onDelete: 'CASCADE'
});
MetaChannel.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop'
});

// Conversation <-> MetaChannel (Phase 2 FK). Each conversation can be pinned
// to a specific Meta page / IG account; null for legacy rows. Surfaced in the
// inbox so the operator sees which channel a thread arrived on.
MetaChannel.hasMany(Conversation, {
    foreignKey: 'meta_channel_id',
    as: 'conversations',
    onDelete: 'SET NULL'
});
Conversation.belongsTo(MetaChannel, {
    foreignKey: 'meta_channel_id',
    as: 'metaChannel'
});

// MetaChannel <-> MetaChannelSettings (1:1)
MetaChannel.hasOne(MetaChannelSettings, {
    foreignKey: 'channel_id',
    as: 'settings',
    onDelete: 'CASCADE'
});
MetaChannelSettings.belongsTo(MetaChannel, {
    foreignKey: 'channel_id',
    as: 'channel'
});

// MetaChannel <-> MetaChannelConsentEvent (1:many, append-only)
MetaChannel.hasMany(MetaChannelConsentEvent, {
    foreignKey: 'channel_id',
    as: 'consentEvents',
    onDelete: 'CASCADE'
});
MetaChannelConsentEvent.belongsTo(MetaChannel, {
    foreignKey: 'channel_id',
    as: 'channel'
});

// Customer <-> MetaChannelConsentEvent (1:many)
Customer.hasMany(MetaChannelConsentEvent, {
    foreignKey: 'customer_id',
    as: 'consentEvents',
    onDelete: 'SET NULL'
});
MetaChannelConsentEvent.belongsTo(Customer, {
    foreignKey: 'customer_id',
    as: 'customer'
});

// OAuth-captured app-scoped <-> Page-scoped identity bridge.
MetaChannel.hasMany(MetaUserIdentity, {
    foreignKey: 'channel_id',
    as: 'userIdentities',
    onDelete: 'CASCADE',
});
MetaUserIdentity.belongsTo(MetaChannel, {
    foreignKey: 'channel_id',
    as: 'channel',
});
Shop.hasMany(MetaUserIdentity, {
    foreignKey: 'shop_id',
    as: 'metaUserIdentities',
    onDelete: 'CASCADE',
});
MetaUserIdentity.belongsTo(Shop, {
    foreignKey: 'shop_id',
    as: 'shop',
});
User.hasMany(MetaUserIdentity, {
    foreignKey: 'internal_user_id',
    as: 'metaUserIdentities',
    onDelete: 'SET NULL',
});
MetaUserIdentity.belongsTo(User, {
    foreignKey: 'internal_user_id',
    as: 'internalUser',
});

// Export entities
module.exports = {
    User,
    Tenant,
    Shop,
    UserShop,
    Category,
    Product,
    ProductVariant,
    Customer,
    Order,
    OrderReturn,
    OrderItem,
    Conversation,
    Message,
    AuditLog,
    IdempotencyKey,
    DeliveryIntegration,
    DeliveryCost,
    KnownArea,
    PaymentConfig,
    Subscription,
    Invoice,
    PartnerApplication,
    UsageEvent,
    Keyword,
    FaqResponse,
    BanglishDictionary,
    Analytics,
    KnowledgeGap,
    SupportTicket,
    ResponseTemplate,
    CustomerPreference,
    TrxIDLog,
    PaymentTransaction,
    OwnerNotification,
    OrderInvoice,
    DeliveryTracking,
    PushSubscription,
    TelegramNotificationBinding,
    PasswordResetToken,
    CustomerDeliveryStats,
    CourierCodCollection,
    ReconciliationDispute,
    GrowthOsUserRole,
    // Phase 1 — Meta Integration Redesign
    MetaChannel,
    MetaChannelSettings,
    MetaChannelConsentEvent,
    MetaUserIdentity,
    MetaDataDeletionRequest,
    MetaWebhookReceipt,
    PolicyDecision,
};

Object.defineProperties(module.exports, {
    GrowthOsProspect: {
        enumerable: true,
        get: () => loadGrowthOsProspectEntities().GrowthOsProspect,
    },
    GrowthOsProspectEvent: {
        enumerable: true,
        get: () => loadGrowthOsProspectEntities().GrowthOsProspectEvent,
    },
});
