const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

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
                const crypto = require('crypto');
                const algorithm = 'aes-256-cbc';
                const key = Buffer.from(process.env.PAYMENT_ENCRYPTION_KEY || 'default-32-char-key-change-me!', 'utf-8').slice(0, 32);
                
                const parts = value.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encrypted = parts[1];
                
                const decipher = crypto.createDecipheriv(algorithm, key, iv);
                let decrypted = decipher.update(encrypted, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                
                return JSON.parse(decrypted);
            } catch (error) {
                console.error('Failed to decrypt credentials:', error);
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
                const crypto = require('crypto');
                const algorithm = 'aes-256-cbc';
                const key = Buffer.from(process.env.PAYMENT_ENCRYPTION_KEY || 'default-32-char-key-change-me!', 'utf-8').slice(0, 32);
                const iv = crypto.randomBytes(16);
                
                const cipher = crypto.createCipheriv(algorithm, key, iv);
                let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                
                this.setDataValue('credentials', iv.toString('hex') + ':' + encrypted);
            } catch (error) {
                console.error('Failed to encrypt credentials:', error);
                this.setDataValue('credentials', null);
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
