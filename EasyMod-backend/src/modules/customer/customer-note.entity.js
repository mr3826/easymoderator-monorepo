const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

// MW-V1 CRM Lite: staff-private customer notes (doc 05). Paranoid (soft delete)
// so retention/erasure remain auditable; body NEVER enters logs/audits.
const CustomerNote = sequelize.define('CustomerNote', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE'
    },
    customer_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onDelete: 'CASCADE'
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { len: [1, 2000] }
    },
    author_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    author_name: {
        type: DataTypes.STRING(160),
        allowNull: true
    }
}, {
    tableName: 'customer_notes',
    underscored: true,
    paranoid: true,
    indexes: [
        { fields: ['shop_id', 'customer_id', 'created_at'] },
        { fields: ['shop_id', 'deleted_at'] }
    ]
});

module.exports = CustomerNote;
