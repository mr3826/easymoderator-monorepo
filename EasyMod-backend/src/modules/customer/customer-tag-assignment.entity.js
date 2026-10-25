const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

// MW-V1 CRM Lite: idempotent tag↔customer assignment (doc 05).
const CustomerTagAssignment = sequelize.define('CustomerTagAssignment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    tag_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'customer_tag_definitions', key: 'id' },
        onDelete: 'CASCADE',
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE',
    },
    created_by: { type: DataTypes.UUID, allowNull: true },
}, {
    tableName: 'customer_tag_assignments',
    underscored: true,
    indexes: [
        { unique: true, fields: ['tag_id', 'customer_id'] },
        { fields: ['shop_id', 'customer_id'] },
    ],
});

module.exports = CustomerTagAssignment;
