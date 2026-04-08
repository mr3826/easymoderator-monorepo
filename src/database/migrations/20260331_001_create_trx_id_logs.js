'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('trx_id_logs', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.literal('gen_random_uuid()'),
                primaryKey: true
            },
            shop_id: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: 'shops', key: 'id' },
                onDelete: 'CASCADE'
            },
            order_id: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'orders', key: 'id' },
                onDelete: 'SET NULL'
            },
            trx_id: {
                type: Sequelize.STRING(64),
                allowNull: false
            },
            mfs_type: {
                type: Sequelize.STRING(20),
                allowNull: false
            },
            amount: {
                type: Sequelize.DECIMAL(10, 2),
                allowNull: true
            },
            sender_phone: {
                type: Sequelize.STRING(20),
                allowNull: true
            },
            receiver_phone: {
                type: Sequelize.STRING(20),
                allowNull: true
            },
            ocr_raw: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            verified_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            created_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('NOW()')
            },
            updated_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('NOW()')
            }
        });

        await queryInterface.addIndex('trx_id_logs', ['shop_id', 'trx_id'], {
            unique: true,
            name: 'trx_id_logs_shop_trx_unique'
        });
        await queryInterface.addIndex('trx_id_logs', ['shop_id', 'order_id'], {
            name: 'trx_id_logs_shop_order'
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('trx_id_logs');
    }
};
