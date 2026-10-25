'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Knowledge Gap Suggestions (Pilot+ P+05). Merchant-reviewable improvement
 * items derived from existing knowledge_gaps evidence. ids + normalized keys
 * + counters only — never raw customer text beyond one short sample line,
 * never contact data.
 */
const KnowledgeGapSuggestion = sequelize.define('KnowledgeGapSuggestion', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    shop_id: { type: DataTypes.UUID, allowNull: false },
    norm_question: { type: DataTypes.STRING(200), allowNull: false },
    display_question: { type: DataTypes.STRING(300), allowNull: false },
    owner_domain: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'POLICY',
    },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OPEN' },
    evidence_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    first_seen_at: { type: DataTypes.DATE, allowNull: false },
    last_seen_at: { type: DataTypes.DATE, allowNull: false },
    evidence_cursor: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    dismissed_reason: { type: DataTypes.STRING(40), allowNull: true },
    dismissed_at: { type: DataTypes.DATE, allowNull: true },
    resolved_faq_id: { type: DataTypes.INTEGER, allowNull: true },
    published_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: 'knowledge_gap_suggestions',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = KnowledgeGapSuggestion;
