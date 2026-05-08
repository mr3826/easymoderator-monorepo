const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * TrxIDLog — MFS transaction ID audit trail
 *
 * Stores every TrxID submitted via self-MFS screenshot, keyed per shop.
 * Enables duplicate-TrxID fraud detection across order sessions.
 *
 * Unique constraint: (shop_id, trx_id) — one TrxID can only be accepted once per shop.
 */
const TrxIDLog = sequelize.define('TrxIDLog', {
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
    order_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'orders', key: 'id' },
        onDelete: 'SET NULL'
    },
    trx_id: {
        type: DataTypes.STRING(64),
        allowNull: false
    },
    mfs_type: {
        type: DataTypes.STRING(20), // 'bkash' | 'nagad' | 'rocket'
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    sender_phone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    receiver_phone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    ocr_raw: {
        type: DataTypes.TEXT,
        allowNull: true  // raw Gemini Vision output for audit
    },
    verified_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'trx_id_logs',
    indexes: [
        { unique: true, fields: ['shop_id', 'trx_id'] },
        { fields: ['shop_id', 'order_id'] }
    ]
});

module.exports = TrxIDLog;
