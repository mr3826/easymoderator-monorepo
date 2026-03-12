const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const crypto = require('crypto');

// Same AES-256-CBC key derivation as payment-config.entity.js (P1-9)
const getDeliveryEncryptionKey = () => {
    const keyEnv = process.env.DELIVERY_ENCRYPTION_KEY;
    const env = process.env.NODE_ENV || 'development';
    if (keyEnv) {
        if (/^[a-f0-9]{64}$/i.test(keyEnv)) {
            return Buffer.from(keyEnv, 'hex');
        }
        return crypto.createHash('sha256').update(keyEnv).digest();
    }
    if (env === 'production' || env === 'staging') {
        throw new Error('DELIVERY_ENCRYPTION_KEY must be set in production/staging');
    }
    return crypto.createHash('sha256').update('default-delivery-encryption-key-change-me').digest();
};

const DELIVERY_ENCRYPTION_KEY = getDeliveryEncryptionKey();

const DeliveryIntegration = sequelize.define('DeliveryIntegration', {
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
    provider: {
        type: DataTypes.ENUM('pathao', 'steadfast'),
        allowNull: false
    },
    credentials: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
            const value = this.getDataValue('credentials');
            if (!value) return null;
            try {
                const algorithm = 'aes-256-cbc';
                const parts = value.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encrypted = parts[1];
                const decipher = crypto.createDecipheriv(algorithm, DELIVERY_ENCRYPTION_KEY, iv);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return JSON.parse(decrypted);
            } catch (error) {
                console.error('Failed to decrypt credentials:', error.message);
                return null;
            }
        },
        set(value) {
            if (!value) {
                this.setDataValue('credentials', null);
                return;
            }
            try {
                const algorithm = 'aes-256-cbc';
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv(algorithm, DELIVERY_ENCRYPTION_KEY, iv);
                let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                this.setDataValue('credentials', iv.toString('hex') + ':' + encrypted);
            } catch (error) {
                console.error('Failed to encrypt credentials:', error.message);
                throw new Error('Credential encryption failed');
            }
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    is_connected: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    last_validated_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'delivery_integrations',
    underscored: true,
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'provider'],
            name: 'unique_shop_provider'
        },
        {
            fields: ['shop_id'],
            name: 'idx_delivery_shop_id'
        },
        {
            fields: ['provider'],
            name: 'idx_delivery_provider'
        }
    ]
});

module.exports = DeliveryIntegration;
