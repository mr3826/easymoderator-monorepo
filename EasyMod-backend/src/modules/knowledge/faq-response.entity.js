const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const FaqResponse = sequelize.define('FaqResponse', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
    category: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    template_bn: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    template_en: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    variables: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    priority: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    use_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    tableName: 'faq_responses',
    underscored: true,
    timestamps: true,
    updatedAt: false
});

module.exports = FaqResponse;
