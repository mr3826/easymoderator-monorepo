require('module-alias/register');
require('dotenv').config();

const { sequelize } = require('../utils/database/database-setup');

const createPaymentConfigsTable = async () => {
    try {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS payment_configs (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                gateway TEXT NOT NULL CHECK(gateway IN ('cod', 'aamarpay', 'sslcommerz', 'self-mfs')),
                is_enabled INTEGER DEFAULT 0,
                credentials TEXT,
                config TEXT DEFAULT '{}',
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE ON UPDATE CASCADE,
                UNIQUE(shop_id, gateway)
            )
        `);

        console.log('payment_configs table created successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error creating payment_configs table:', error);
        process.exit(1);
    }
};

createPaymentConfigsTable();
