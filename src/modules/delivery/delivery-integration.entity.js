const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');
const crypto = require('crypto');

// Encryption key should be in environment variables
const ENCRYPTION_KEY = process.env.DELIVERY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

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
            const encrypted = this.getDataValue('credentials');
            if (!encrypted) return null;
            
            try {
                // Decrypt credentials
                const parts = encrypted.split(':');
                const iv = Buffer.from(parts[0], 'hex');
                const encryptedText = Buffer.from(parts[1], 'hex');
                const key = Buffer.from(ENCRYPTION_KEY.substring(0, 64), 'hex');
                
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                const authTag = Buffer.from(parts[2], 'hex');
                decipher.setAuthTag(authTag);
                
                let decrypted = decipher.update(encryptedText, undefined, 'utf8');
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
                // Encrypt credentials
                const text = JSON.stringify(value);
                const key = Buffer.from(ENCRYPTION_KEY.substring(0, 64), 'hex');
                const iv = crypto.randomBytes(16);
                
                const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
                
                let encrypted = cipher.update(text, 'utf8', 'hex');
                encrypted += cipher.final('hex');
                
                const authTag = cipher.getAuthTag();
                
                // Store as iv:encrypted:authTag
                const encryptedValue = iv.toString('hex') + ':' + encrypted + ':' + authTag.toString('hex');
                this.setDataValue('credentials', encryptedValue);
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
