const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const Analytics = sequelize.define('Analytics', {
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
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    total_messages: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    llm_calls: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    cache_hits: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    keyword_matches: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    cost_estimate: {
        type: DataTypes.DECIMAL(10, 4),
        defaultValue: 0
    }
}, {
    tableName: 'analytics',
    underscored: true,
    timestamps: false
});

module.exports = Analytics;
