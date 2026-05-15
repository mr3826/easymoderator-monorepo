const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const Session = sequelize.define('Session', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'shops',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    session_token: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: 'user_session_token_unique'
    },
    device_fingerprint: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Device fingerprint for session identification'
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Browser user agent string'
    },
    ip_address: {
        type: DataTypes.INET,
        allowNull: true,
        comment: 'IP address of session creation'
    },
    location: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Geographic location data (country, city, etc.)'
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Session expiration time'
    },
    last_activity_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Last activity timestamp for this session'
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional session metadata (device type, OS, etc.)'
    }
}, {
    tableName: 'user_sessions',
    schema: process.env.DB_SCHEMA || 'public',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['user_id', 'session_token']
        },
        {
            fields: ['user_id']
        },
        {
            fields: ['expires_at']
        },
        {
            fields: ['is_active']
        }
    ]
});

module.exports = Session;
