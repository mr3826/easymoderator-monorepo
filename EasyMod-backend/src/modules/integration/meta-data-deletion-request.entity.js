'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Durable, non-PII status record for a Meta data-deletion callback.
 *
 * Raw signed requests, app-scoped IDs, confirmation codes, and attachment URLs
 * are never stored. Fingerprints/hashes provide idempotency and status lookup.
 */
const MetaDataDeletionRequest = sequelize.define('MetaDataDeletionRequest', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    request_fingerprint: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    identity_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
    },
    confirmation_code_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
    },
    status: {
        type: DataTypes.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
    },
    matched_customer_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    conversations_deleted_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    messages_deleted_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    orders_anonymized_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    attachments_deleted_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    pending_attachment_paths: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Server-owned relative paths only; never remote URLs',
    },
    failure_code: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },
    failure_detail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Sanitized operational detail with no personal data',
    },
    started_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    data_phase_completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Transactional database deletion/anonymization committed',
    },
    completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: 'meta_data_deletion_requests',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['identity_hash'], name: 'idx_meta_deletion_identity_hash' },
        { fields: ['status', 'created_at'], name: 'idx_meta_deletion_status_created' },
    ],
});

module.exports = MetaDataDeletionRequest;
