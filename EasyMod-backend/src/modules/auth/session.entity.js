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
    },
    // ADR M-004: native per-device refresh-token rotation. Nullable/defaulted
    // so this remains additive for any pre-existing row shape.
    //
    // Chosen lineage strategy: the refresh token itself is a signed JWT
    // carrying { sid, generation } (see native/native-token.util.js), and
    // this row stores only the hash of the CURRENT valid token plus that
    // same generation counter. Reuse of an old (already-rotated) token is
    // detected because its embedded `generation` — or its hash — no longer
    // matches this row's current values, while its `sid` still correctly
    // names this session's lineage (the JWT signature proves that). This
    // avoids a second table of historical token hashes: the generation
    // counter is enough to tell "stale token from this family" apart from
    // "token that was never part of this family" (the latter fails JWT
    // signature verification before it ever reaches a row lookup).
    refresh_token_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'SHA-256 hash of the current valid native refresh token for this session'
    },
    refresh_token_generation: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Rotation counter for the native refresh token lineage; incremented on every rotation'
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
