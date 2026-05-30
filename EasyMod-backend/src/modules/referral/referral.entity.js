const { DataTypes } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');

/**
 * Referral — records one shop inviting another into EasyModerator.
 *
 * The referral CODE is the referrer shop's existing `unique_code` (no new code
 * to generate). One row is created per referred shop at signup time, and both
 * sides are immediately rewarded with bonus conversations (acquisition loop).
 */
const Referral = sequelize.define('Referral', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referrer_shop_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  referred_shop_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true // a shop can only be referred once
  },
  referred_user_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  code: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'rewarded' // 'rewarded' once both bonuses are granted
  },
  referrer_reward: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  referred_reward: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  rewarded_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'referrals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['referrer_shop_id'] },
    { fields: ['code'] }
  ]
});

module.exports = Referral;
