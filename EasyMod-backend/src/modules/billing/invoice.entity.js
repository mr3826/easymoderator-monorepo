const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

// Model name must differ from subscription/invoice.entity's 'Invoice' —
// duplicate names silently replace each other in sequelize.models, which
// breaks registry-based tooling (e.g. the schema-drift audit).
const Invoice = sequelize.define('OrderInvoice', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    order_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'orders',
            key: 'id'
        },
        onDelete: 'CASCADE'
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
    invoice_number: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        comment: 'Formal invoice number: INV-YYYYMM-XXXXXX'
    },
    pdf_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'URL to generated PDF invoice'
    },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'generated',
        comment: 'generated, sent, delivered, failed'
    },
    sent_via: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Array of channels used: ["whatsapp", "email", "facebook"]'
    },
    customer_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Customer information at time of invoice'
    },
    order_data: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Order data snapshot'
    },
    payment_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Payment information and status'
    },
    tax_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Tax calculation details'
    },
    delivery_info: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Delivery information'
    },
    qr_code_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'QR code for easy tracking'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'order_invoices',
    underscored: true,
    timestamps: true,
    indexes: [
        { fields: ['order_id'] },
        { fields: ['shop_id'] },
        { fields: ['invoice_number'] },
        { fields: ['status'] },
        { fields: ['shop_id', 'status'] },
        { fields: ['created_at'] }
    ]
});

module.exports = Invoice;
