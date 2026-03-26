const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * FormSchema — defines a custom order form for a shop.
 * Each field definition follows the shape:
 *   { key, label, type: 'text'|'select'|'number', required: true|false, options: [] }
 */
const FormSchema = sequelize.define('FormSchema', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    fields: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of field definitions: { key, label, type, required, options }'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'form_schemas',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['shop_id'] },
        { fields: ['shop_id', 'is_active'] }
    ]
});

module.exports = FormSchema;
