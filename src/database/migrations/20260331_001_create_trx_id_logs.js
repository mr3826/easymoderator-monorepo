'use strict';

module.exports = {
    name: '20260331_001_create_trx_id_logs',

    async up(sequelize) {
        const qi = sequelize.getQueryInterface();
        await qi.createTable('trx_id_logs', {
            id: {
                type: 'UUID',
                defaultValue: sequelize.literal('gen_random_uuid()'),
                primaryKey: true
            },
            shop_id: {
                type: 'UUID',
                allowNull: false,
                references: { model: 'shops', key: 'id' },
                onDelete: 'CASCADE'
            },
            order_id: {
                type: 'UUID',
                allowNull: true,
                references: { model: 'orders', key: 'id' },
                onDelete: 'SET NULL'
            },
            trx_id: {
                type: 'VARCHAR(64)',
                allowNull: false
            },
            mfs_type: {
                type: 'VARCHAR(20)',
                allowNull: false
            },
            amount: {
                type: 'DECIMAL(10, 2)',
                allowNull: true
            },
            sender_phone: {
                type: 'VARCHAR(20)',
                allowNull: true
            },
            receiver_phone: {
                type: 'VARCHAR(20)',
                allowNull: true
            },
            ocr_raw: {
                type: 'TEXT',
                allowNull: true
            },
            verified_at: {
                type: 'TIMESTAMPTZ',
                allowNull: true
            },
            created_at: {
                type: 'TIMESTAMPTZ',
                defaultValue: sequelize.literal('NOW()')
            },
            updated_at: {
                type: 'TIMESTAMPTZ',
                defaultValue: sequelize.literal('NOW()')
            }
        });

        await qi.addIndex('trx_id_logs', ['shop_id', 'trx_id'], {
            unique: true,
            name: 'trx_id_logs_shop_trx_unique'
        });
        await qi.addIndex('trx_id_logs', ['shop_id', 'order_id'], {
            name: 'trx_id_logs_shop_order'
        });
    },

    async down(sequelize) {
        await sequelize.getQueryInterface().dropTable('trx_id_logs');
    }
};
