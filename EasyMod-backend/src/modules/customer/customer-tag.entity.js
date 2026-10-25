const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

// MW-V1 CRM Lite: shop-scoped merchant tag vocabulary (doc 05).
const CustomerTag = sequelize.define('CustomerTag', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    name: { type: DataTypes.STRING(30), allowNull: false },
    name_lower: { type: DataTypes.STRING(30), allowNull: false },
    created_by: { type: DataTypes.UUID, allowNull: true },
}, {
    tableName: 'customer_tag_definitions',
    underscored: true,
    indexes: [{ unique: true, fields: ['shop_id', 'name_lower'] }],
});

module.exports = CustomerTag;
