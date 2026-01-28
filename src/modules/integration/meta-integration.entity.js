const { DataTypes } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');

const MetaIntegration = sequelize.define('MetaIntegration', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  shop_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'shops',
      key: 'id'
    }
  },
  platform: {
    type: DataTypes.ENUM('messenger', 'instagram', 'whatsapp'),
    allowNull: false,
  },
  meta_asset_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Facebook Page ID, Instagram Account ID, or WhatsApp Business Account ID'
  },
  display_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Human-readable name of the connected asset'
  },
  access_token: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Encrypted Meta access token'
  },
  connected_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  status: {
    type: DataTypes.ENUM('CONNECTED', 'DISCONNECTED', 'ERROR'),
    allowNull: false,
    defaultValue: 'CONNECTED',
  },
  webhook_subscription_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Meta webhook subscription ID for cleanup'
  }
}, {
  tableName: 'meta_integrations',
  indexes: [
    {
      unique: true,
      fields: ['shop_id', 'platform'],
      name: 'unique_shop_platform'
    },
    {
      unique: true,
      fields: ['meta_asset_id'],
      name: 'unique_meta_asset'
    },
    {
      fields: ['shop_id'],
      name: 'idx_shop_id'
    },
    {
      fields: ['platform'],
      name: 'idx_platform'
    }
  ],
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Define relationships
const Shop = require('src/modules/shop/shop.entity');
MetaIntegration.belongsTo(Shop, {
  foreignKey: 'shop_id',
  as: 'shop'
});

Shop.hasMany(MetaIntegration, {
  foreignKey: 'shop_id',
  as: 'metaIntegrations'
});

module.exports = MetaIntegration;