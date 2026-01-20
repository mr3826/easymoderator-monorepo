const User = require('src/modules/user/user.entity');
const Shop = require('src/modules/shop/shop.entity');
const UserShop = require('src/modules/user-shop/user-shop.entity');
const Category = require('src/modules/category/category.entity');
const Product = require('src/modules/product/product.entity');
const Customer = require('src/modules/customer/customer.entity');
const Order = require('src/modules/order/order.entity');
const OrderItem = require('src/modules/order/order-item.entity');

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
    as: 'category'
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
    as: 'items',
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

// Export entities
module.exports = {
    User,
    Shop,
    UserShop,
    Category,
    Product,
    Customer,
    Order,
    OrderItem
};
