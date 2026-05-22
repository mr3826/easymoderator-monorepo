/**
 * MetaChannel entity
 *
 * Single source of truth for a shop's connected Facebook Page or
 * Instagram Business Account. Replaces channel_configs + meta_integrations
 * during the Phase 1-5 dual-write transition.
 *
 * Token encryption: uses meta-token-cipher (AES-256-GCM, versioned v2 prefix).
 * The page_access_token_ct field stores the ciphertext; the virtual getter/setter
 * on the same field transparently encrypts on write and decrypts on read.
 * Getter returns null on decryption failure (corrupted data) rather than throwing.
 */

'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const cipher = require('../../utils/meta-token-cipher');

const MetaChannel = sequelize.define('MetaChannel', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    platform: {
        type: DataTypes.ENUM('facebook', 'instagram'),
        allowNull: false,
        comment: 'WhatsApp removed from product scope (see Phase 1 plan)',
    },
    meta_asset_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: 'Facebook Page ID or Instagram Business Account ID',
    },
    display_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    picture_url: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    linked_fb_page_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'For Instagram channels: parent Facebook Page ID used for webhook subscription',
    },

    // ----- Token storage (encrypted at rest) -----
    page_access_token_ct: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'AES-256-GCM encrypted page access token. Format: v2:iv:authTag:ct',

        /**
         * Getter: decrypt ciphertext -> plaintext.
         * Returns null on error (corrupted data) rather than throwing,
         * so a bad row does not crash the whole model load.
         */
        get() {
            const value = this.getDataValue('page_access_token_ct');
            if (!value) return null;
            try {
                return cipher.decrypt(value);
            } catch (err) {
                // Log but do not propagate — avoids crash on corrupted row
                const logger = (() => {
                    try { return require('../../utils/structured-logger').createLogger('meta-channel'); }
                    catch (_) { return console; }
                })();
                logger.error('MetaChannel: failed to decrypt page_access_token_ct', { error: err.message });
                return null;
            }
        },

        /**
         * Setter: encrypt plaintext -> ciphertext.
         * Stores null directly when value is null/undefined.
         */
        set(value) {
            if (value === null || value === undefined) {
                this.setDataValue('page_access_token_ct', null);
                return;
            }
            this.setDataValue('page_access_token_ct', cipher.encrypt(value));
        },
    },

    token_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When the stored page access token expires (Meta long-lived tokens ~60 days)',
    },
    token_last_refreshed_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    token_refresh_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Consecutive failed token refresh attempts; reset to 0 on success',
    },

    // ----- Webhook -----
    webhook_verify_token: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
        comment: 'Per-channel CSRF token for Meta webhook GET handshake',
    },
    webhook_subscribed_fields: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'Fields subscribed to on the Meta webhook (e.g. ["messages","messaging_optins"])',
    },
    webhook_last_verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },

    // ----- Status -----
    status: {
        type: DataTypes.ENUM('CONNECTED', 'TOKEN_EXPIRED', 'REVOKED', 'DISCONNECTED', 'ERROR'),
        allowNull: false,
        defaultValue: 'CONNECTED',
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
    },

    // ----- Audit -----
    connected_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        comment: 'User who completed the OAuth flow for this channel',
    },
    connected_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    disconnected_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    tableName: 'meta_channels',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false, // soft delete not needed; REVOKED/DISCONNECTED status tracks lifecycle
    indexes: [
        // Phase 1: allow multiple channels per (shop_id, platform). Uniqueness is now
        // on (shop_id, meta_asset_id) so each Page/IG account gets its own row.
        // Cross-shop ownership of the same asset is enforced in the service layer.
        { unique: true, fields: ['shop_id', 'meta_asset_id'], name: 'unique_meta_channels_shop_asset' },
        { unique: true, fields: ['webhook_verify_token'], name: 'unique_meta_channel_verify_token' },
        { fields: ['shop_id', 'platform'], name: 'idx_meta_channel_shop_platform' },
        { fields: ['status'], name: 'idx_meta_channel_status' },
        { fields: ['token_expires_at'], name: 'idx_meta_channel_token_expires_at' },
    ],
});

module.exports = MetaChannel;
