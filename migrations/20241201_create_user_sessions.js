'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('user_sessions', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true,
                allowNull: false
            },
            user_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                },
                onDelete: 'CASCADE'
            },
            shop_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: 'shops',
                    key: 'id'
                },
                onDelete: 'CASCADE'
            },
            session_token: {
                type: Sequelize.STRING(255),
                allowNull: false,
                unique: true
            },
            device_fingerprint: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            user_agent: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            ip_address: {
                type: Sequelize.INET,
                allowNull: true
            },
            location: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            is_active: {
                type: Sequelize.BOOLEAN,
                defaultValue: true,
                allowNull: false
            },
            expires_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            last_activity_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            metadata: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        // Create indexes for performance
        await queryInterface.addIndex('user_sessions', ['user_id', 'session_token'], {
            unique: true,
            name: 'user_sessions_user_session_unique'
        });
        
        await queryInterface.addIndex('user_sessions', ['user_id']);
        await queryInterface.addIndex('user_sessions', ['expires_at']);
        await queryInterface.addIndex('user_sessions', ['is_active']);
        
        // Add foreign key constraints
        await queryInterface.addConstraint('user_sessions', {
            fields: ['user_id'],
            type: 'foreign key',
            name: 'user_sessions_user_id_fkey',
            references: {
                table: 'users',
                field: 'id'
            },
            onDelete: 'CASCADE'
        });
        
        await queryInterface.addConstraint('user_sessions', {
            fields: ['shop_id'],
            type: 'foreign key',
            name: 'user_sessions_shop_id_fkey',
            references: {
                table: 'shops',
                field: 'id'
            },
            onDelete: 'CASCADE'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('user_sessions');
    }
};
