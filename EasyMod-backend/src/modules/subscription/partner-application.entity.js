const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Partner Application
 *
 * A shop's request to join the per-delivered-order Partner plan. Submitted from
 * the public Pricing page (and from the in-app Subscription page). Persisted so
 * no application is lost; an admin approves via the admin endpoint or the
 * scripts/approve-partner.js CLI, which flips the shop's subscription to PARTNER.
 */
const PartnerApplication = sequelize.define('PartnerApplication', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    // Nullable — the public Pricing form has no authenticated shop yet. When an
    // in-app shop applies, this links the application to that shop.
    shop_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    business_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false
    },
    page_link: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending'
    },
    // Admin identifier (email/id) that actioned the application.
    reviewed_by: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
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
    tableName: 'partner_applications',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['status'] },
        { fields: ['shop_id'] }
    ]
});

module.exports = PartnerApplication;
