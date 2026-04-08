const crypto = require('crypto');
const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

// Derive encryption key once at module load — avoids re-hashing on every ORM getter/setter call.
let _cachedEncryptionKey = null;
function getEncryptionKey() {
    if (_cachedEncryptionKey) return _cachedEncryptionKey;
    const keyEnv = process.env.CHANNEL_ENCRYPTION_KEY;
    if (!keyEnv) throw new Error('CHANNEL_ENCRYPTION_KEY not set');
    _cachedEncryptionKey = /^[a-f0-9]{64}$/i.test(keyEnv)
        ? Buffer.from(keyEnv, 'hex')
        : crypto.createHash('sha256').update(keyEnv).digest();
    return _cachedEncryptionKey;
}

const Channel = sequelize.define('Channel', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
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
    channel_type: {
        type: DataTypes.ENUM('messenger', 'whatsapp', 'instagram', 'webchat', 'telegram'),
        allowNull: false
    },
    page_id: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    access_token: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
            const value = this.getDataValue('access_token');
            if (!value) return null;
            try {
                const ENCRYPTION_KEY = getEncryptionKey();
                const parts = value.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encrypted = parts[1];
                const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            } catch (error) {
                console.error('Failed to decrypt access_token:', error.message);
                return null;
            }
        },
        set(value) {
            if (!value) {
                this.setDataValue('access_token', null);
                return;
            }
            try {
                const ENCRYPTION_KEY = getEncryptionKey();
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
                let encrypted = cipher.update(value, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                this.setDataValue('access_token', iv.toString('hex') + ':' + encrypted);
            } catch (error) {
                console.error('Failed to encrypt access_token:', error.message);
                throw new Error('Access token encryption failed: ' + error.message);
            }
        }
    },
    verify_token: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    webhook_secret: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    token_expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'channel_configs',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'channel_type']
        }
    ]
});

module.exports = Channel;
