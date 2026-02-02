const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');
const crypto = require('crypto');

// Generate or use encryption key (must be exactly 32 bytes for AES-256)
const getEncryptionKey = () => {
    const keyEnv = process.env.PAYMENT_ENCRYPTION_KEY;
    if (keyEnv) {
        // If it's hex, convert from hex; otherwise treat as string and hash
        if (/^[a-f0-9]{64}$/i.test(keyEnv)) {
            // Already 64 hex chars = 32 bytes
            return Buffer.from(keyEnv, 'hex');
        } else {
            // Hash the string to get consistent 32 bytes
            return crypto.createHash('sha256').update(keyEnv).digest();
        }
    }
    // Default key (change in production!)
    return crypto.createHash('sha256').update('default-payment-encryption-key-change-me').digest();
};

const ENCRYPTION_KEY = getEncryptionKey();

const PaymentConfig = sequelize.define('PaymentConfig', {
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
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    gateway: {
        type: DataTypes.ENUM('cod', 'aamarpay', 'sslcommerz', 'self-mfs'),
        allowNull: false
    },
    is_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Encrypted credentials stored as JSON
    credentials: {
        type: DataTypes.TEXT,
        allowNull: true,
        get() {
            const value = this.getDataValue('credentials');
            if (!value) return null;
            try {
                // Decrypt and parse JSON
                const algorithm = 'aes-256-cbc';
                
                const parts = value.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encrypted = parts[1];
                
                const decipher = crypto.createDecipheriv(algorithm, ENCRYPTION_KEY, iv);
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
                // Encrypt JSON data
                const algorithm = 'aes-256-cbc';
                const iv = crypto.randomBytes(16);
                
                const cipher = crypto.createCipheriv(algorithm, ENCRYPTION_KEY, iv);
                let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                
                this.setDataValue('credentials', iv.toString('hex') + ':' + encrypted);
            } catch (error) {
                console.error('Failed to encrypt credentials:', error.message);
                throw new Error('Credential encryption failed: ' + error.message);
            }
        }
    },
    // Additional configuration options (non-sensitive)
    config: {
        type: DataTypes.JSON,
        defaultValue: {}
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
    tableName: 'payment_configs',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['shop_id', 'gateway']
        }
    ]
});

module.exports = PaymentConfig;
