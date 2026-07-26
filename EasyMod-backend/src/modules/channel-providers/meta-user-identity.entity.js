'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Legitimate Meta identity bridge captured during Facebook Login.
 *
 * `app_scoped_user_id` comes from `/me` with the OAuth user token.
 * `page_scoped_user_id` comes from the `ids_for_pages` edge for the same user.
 * A row may have a null page-scoped ID when Meta returns the app user but not a
 * Page identity. That row is still sufficient to deauthorize the connected
 * channel, but it must never be used to guess a customer identity.
 */
const MetaUserIdentity = sequelize.define('MetaUserIdentity', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    app_scoped_user_id: {
        type: DataTypes.STRING(128),
        allowNull: false,
    },
    page_scoped_user_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
    },
    internal_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE',
    },
    channel_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'meta_channels', key: 'id' },
        onDelete: 'CASCADE',
    },
    source: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'facebook_oauth',
    },
    is_current_connection: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    last_verified_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'meta_user_identities',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['app_scoped_user_id', 'channel_id'],
            name: 'uq_meta_user_identities_app_channel',
        },
        {
            fields: ['shop_id', 'page_scoped_user_id'],
            name: 'idx_meta_user_identities_shop_psid',
        },
        {
            fields: ['internal_user_id'],
            name: 'idx_meta_user_identities_internal_user',
        },
        {
            unique: true,
            fields: ['channel_id'],
            where: { is_current_connection: true },
            name: 'uq_meta_user_identities_current_channel',
        },
    ],
});

module.exports = MetaUserIdentity;
