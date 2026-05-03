const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

const KnowledgeGap = sequelize.define('KnowledgeGap', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    shop_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'shops', key: 'id' },
        onDelete: 'CASCADE'
    },
    question: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    platform: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    language: {
        type: DataTypes.STRING(20),
        defaultValue: 'mixed'
    },
    source: {
        type: DataTypes.STRING(100),
        defaultValue: 'ai_handler'
    }
}, {
    tableName: 'knowledge_gaps',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

module.exports = KnowledgeGap;
