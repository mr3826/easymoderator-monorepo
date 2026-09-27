'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Platform-controlled pilot flags, one row per shop. Written only through the
 * SUPER_ADMIN admin API — never through shops.settings, which any shop member
 * can patch (ADR-0009). An absent row means every pilot feature is off.
 */
const ShopPilotFeatures = sequelize.define('ShopPilotFeatures', {
    shop_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    customer_intelligence: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    order_confidence_mode: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'off',
    },
    order_confidence_config: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
    },
    updated_by: {
        type: DataTypes.UUID,
        allowNull: true,
    },
}, {
    tableName: 'shop_pilot_features',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = ShopPilotFeatures;
