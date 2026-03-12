'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('order_sessions', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true
            },
            shop_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'shops',
                    key: 'id'
                },
                onDelete: 'CASCADE'
            },
            customer_id: {
                type: Sequelize.UUID,
                allowNull: true
            },
            customer_channel_id: {
                type: Sequelize.STRING,
                allowNull: false
            },
            channel: {
                type: Sequelize.STRING(20),
                allowNull: false,
                defaultValue: 'messenger'
            },
            current_step: {
                type: Sequelize.STRING(50),
                allowNull: false,
                defaultValue: 'INITIAL'
            },
            step_data: {
                type: Sequelize.JSON,
                allowNull: true,
                defaultValue: {}
            },
            product_info: {
                type: Sequelize.JSON,
                allowNull: true
            },
            status: {
                type: Sequelize.ENUM('ACTIVE', 'COMPLETED', 'CANCELLED', 'ABANDONED'),
                allowNull: false,
                defaultValue: 'ACTIVE'
            },
            automation_mode: {
                type: Sequelize.ENUM('FULL_AUTO', 'DRAFT', 'NOTIFY_ONLY'),
                allowNull: false,
                defaultValue: 'DRAFT'
            },
            confidence_threshold: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 60
            },
            last_activity_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            },
            expires_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            created_order_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: 'orders',
                    key: 'id'
                }
            },
            final_summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            metadata: {
                type: Sequelize.JSON,
                allowNull: true,
                defaultValue: {}
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            }
        });

        // Add indexes
        await queryInterface.addIndex('order_sessions', ['shop_id']);
        await queryInterface.addIndex('order_sessions', ['customer_id']);
        await queryInterface.addIndex('order_sessions', ['customer_channel_id', 'shop_id']);
        await queryInterface.addIndex('order_sessions', ['status']);
        await queryInterface.addIndex('order_sessions', ['current_step']);
        await queryInterface.addIndex('order_sessions', ['last_activity_at']);
        await queryInterface.addIndex('order_sessions', ['expires_at']);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('order_sessions');
    }
};
