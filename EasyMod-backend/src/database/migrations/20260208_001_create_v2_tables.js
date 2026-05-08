'use strict';

/**
 * Migration: Create V2 tables (new entities)
 *
 * Purpose: Add core V2 entities introduced by the API modernization.
 * Backward Compatibility: YES (creates new tables only)
 */

module.exports = {
  name: '20260208_001_create_v2_tables',

  up: async (sequelize) => {
    const { DataTypes } = require('sequelize');
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable('tenants', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      settings: {
        type: DataTypes.JSON,
        allowNull: true,
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
    }).catch(() => {});

    await queryInterface.createTable('order_returns', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      order_id: {
        type: DataTypes.UUID,
        allowNull: false
      },
      customer_id: {
        type: DataTypes.UUID,
        allowNull: false
      },
      reason: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      items: {
        type: DataTypes.JSON,
        defaultValue: []
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('pending_approval', 'approved', 'rejected'),
        defaultValue: 'pending_approval'
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
    }).catch(() => {});

    await queryInterface.createTable('faq_responses', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      category: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      template_bn: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      template_en: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      variables: {
        type: DataTypes.JSON,
        defaultValue: []
      },
      priority: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }).catch(() => {});

    await queryInterface.createTable('banglish_dictionary', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      banglish: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
      },
      bangla: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      confidence: {
        type: DataTypes.INTEGER,
        defaultValue: 100
      }
    }).catch(() => {});

    await queryInterface.createTable('keywords', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      pattern: {
        type: DataTypes.STRING(500),
        allowNull: false
      },
      pattern_type: {
        type: DataTypes.ENUM('exact', 'contains', 'startswith', 'regex'),
        defaultValue: 'contains'
      },
      response_type: {
        type: DataTypes.ENUM('direct_answer', 'faq', 'quick_action', 'redirect_intent'),
        allowNull: false
      },
      response_data: {
        type: DataTypes.JSON,
        allowNull: false
      },
      language: {
        type: DataTypes.ENUM('bn', 'en', 'banglish', 'any'),
        defaultValue: 'any'
      },
      priority: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }).catch(() => {});

    await queryInterface.createTable('analytics', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      total_messages: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      llm_calls: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      cache_hits: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      keyword_matches: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      cost_estimate: {
        type: DataTypes.DECIMAL(10, 4),
        defaultValue: 0
      }
    }).catch(() => {});

    await queryInterface.createTable('support_tickets', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      ticket_number: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: false
      },
      shop_id: {
        type: DataTypes.UUID,
        allowNull: false
      },
      customer_id: {
        type: DataTypes.UUID,
        allowNull: false
      },
      conversation_id: {
        type: DataTypes.UUID,
        allowNull: true
      },
      priority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
        defaultValue: 'low'
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'),
        defaultValue: 'open'
      },
      assigned_to: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      metadata: {
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
    }).catch(() => {});

    await queryInterface.createTable('delivery_costs', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      zone_type: {
        type: DataTypes.STRING(20),
        allowNull: false
      },
      cost: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
      },
      estimated_days: {
        type: DataTypes.INTEGER,
        defaultValue: 1
      }
    }).catch(() => {});

    await queryInterface.createTable('known_areas', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      area_name: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      area_name_bn: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      zone_type: {
        type: DataTypes.ENUM('inside_city', 'outside_city', 'suburban'),
        allowNull: false
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }).catch(() => {});

    await queryInterface.addIndex('order_returns', ['order_id']).catch(() => {});
    await queryInterface.addIndex('order_returns', ['customer_id']).catch(() => {});
    await queryInterface.addIndex('faq_responses', ['shop_id']).catch(() => {});
    await queryInterface.addIndex('keywords', ['shop_id']).catch(() => {});
    await queryInterface.addIndex('analytics', ['shop_id', 'date']).catch(() => {});
    await queryInterface.addIndex('support_tickets', ['tenant_id']).catch(() => {});
    await queryInterface.addIndex('support_tickets', ['shop_id']).catch(() => {});
    await queryInterface.addIndex('delivery_costs', ['shop_id']).catch(() => {});
    await queryInterface.addIndex('known_areas', ['shop_id']).catch(() => {});
  },

  down: async (sequelize) => {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.removeIndex('known_areas', ['shop_id']).catch(() => {});
    await queryInterface.removeIndex('delivery_costs', ['shop_id']).catch(() => {});
    await queryInterface.removeIndex('support_tickets', ['shop_id']).catch(() => {});
    await queryInterface.removeIndex('support_tickets', ['tenant_id']).catch(() => {});
    await queryInterface.removeIndex('analytics', ['shop_id', 'date']).catch(() => {});
    await queryInterface.removeIndex('keywords', ['shop_id']).catch(() => {});
    await queryInterface.removeIndex('faq_responses', ['shop_id']).catch(() => {});
    await queryInterface.removeIndex('order_returns', ['customer_id']).catch(() => {});
    await queryInterface.removeIndex('order_returns', ['order_id']).catch(() => {});

    await queryInterface.dropTable('known_areas').catch(() => {});
    await queryInterface.dropTable('delivery_costs').catch(() => {});
    await queryInterface.dropTable('support_tickets').catch(() => {});
    await queryInterface.dropTable('analytics').catch(() => {});
    await queryInterface.dropTable('keywords').catch(() => {});
    await queryInterface.dropTable('banglish_dictionary').catch(() => {});
    await queryInterface.dropTable('faq_responses').catch(() => {});
    await queryInterface.dropTable('order_returns').catch(() => {});
    await queryInterface.dropTable('tenants').catch(() => {});
  }
};
