const User = require('./user/user.entity');
const Tenant = require('./tenant/tenant.entity');
const Shop = require('./shop/shop.entity');
const UserShop = require('./user-shop/user-shop.entity');
const Category = require('./category/category.entity');
const Product = require('./product/product.entity');
const Customer = require('./customer/customer.entity');
const Order = require('./order/order.entity');
const OrderReturn = require('./order/order-return.entity');
const OrderItem = require('./order/order-item.entity');
const Channel = require('./channel/channel.entity');
const { Conversation, Message } = require('./conversation/conversation.entity');
const AuditLog = require('./audit/audit-log.entity');
const IdempotencyKey = require('./audit/idempotency-key.entity');
const MetaIntegration = require('./integration/meta-integration.entity');
const DeliveryIntegration = require('./delivery/delivery-integration.entity');
const DeliveryCost = require('./delivery/delivery-cost.entity');
const KnownArea = require('./delivery/known-area.entity');
const PaymentConfig = require('./payment/payment-config.entity');
const Subscription = require('./subscription/subscription.entity');
const Invoice = require('./subscription/invoice.entity');
const UsageEvent = require('./subscription/usage-event.entity');
const Keyword = require('./keyword/keyword.entity');
const FaqResponse = require('./knowledge/faq-response.entity');
const BanglishDictionary = require('./language/banglish-dictionary.entity');
const Analytics = require('./analytics/analytics.entity');
const SupportTicket = require('./support/support-ticket.entity');

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

// Define Shop-Channel relationship
Shop.hasMany(Channel, {
    foreignKey: 'shop_id',
    as: 'channels',
    onDelete: 'CASCADE'
});

Channel.belongsTo(Shop, {
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

// Define support ticket relationships
SupportTicket.belongsTo(Shop, { foreignKey: 'shop_id', as: 'shop' });
Shop.hasMany(SupportTicket, { foreignKey: 'shop_id', as: 'support_tickets' });

// Export entities
module.exports = {
    User,
    Tenant,
    Shop,
    UserShop,
    Category,
    Product,
    Customer,
    Order,
    OrderReturn,
    OrderItem,
    Channel,
    Conversation,
    Message,
    AuditLog,
    IdempotencyKey,
    MetaIntegration,
    DeliveryIntegration,
    DeliveryCost,
    KnownArea,
    PaymentConfig,
    Subscription,
    Invoice,
    UsageEvent,
    Keyword,
    FaqResponse,
    BanglishDictionary,
    Analytics,
    SupportTicket
};
