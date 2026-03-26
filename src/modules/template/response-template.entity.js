const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const ResponseTemplate = sequelize.define('ResponseTemplate', {
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
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    variables: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    category: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'e.g. greeting, shipping, refund'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'response_templates',
    underscored: true,
    timestamps: true
});

module.exports = ResponseTemplate;
