const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const Keyword = sequelize.define('Keyword', {
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
    pattern: {
        type: DataTypes.STRING(500),
        allowNull: false
    },
    pattern_type: {
        type: DataTypes.ENUM('exact', 'contains', 'startswith', 'regex'),
        defaultValue: 'contains'
    },
    response_type: {
        type: DataTypes.ENUM('direct_answer', 'faq', 'quick_action', 'redirect_intent'),
        allowNull: false
    },
    response_data: {
        type: DataTypes.JSON,
        allowNull: false
    },
    language: {
        type: DataTypes.ENUM('bn', 'en', 'banglish', 'any'),
        defaultValue: 'any'
    },
    priority: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'keywords',
    underscored: true,
    timestamps: true,
    updatedAt: false
});

module.exports = Keyword;
