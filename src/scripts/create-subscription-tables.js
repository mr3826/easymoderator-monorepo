require('module-alias/register');
require('dotenv').config();

const { sequelize } = require('src/utils/database/database-setup');

const createSubscriptionTables = async () => {
    try {
        // Create subscriptions table
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL UNIQUE,
                plan_name TEXT NOT NULL DEFAULT 'Free',
                plan_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                billing_cycle TEXT NOT NULL DEFAULT 'monthly',
                status TEXT NOT NULL DEFAULT 'active',
                conversations_limit INTEGER NOT NULL DEFAULT 100,
                orders_limit INTEGER NOT NULL DEFAULT 50,
                products_limit INTEGER NOT NULL DEFAULT 100,
                conversations_used INTEGER DEFAULT 0,
                orders_used INTEGER DEFAULT 0,
                products_used INTEGER DEFAULT 0,
                extra_conversations INTEGER DEFAULT 0,
                extra_charge DECIMAL(10,2) DEFAULT 0,
                features TEXT DEFAULT '{}',
                current_period_start DATETIME NOT NULL,
                current_period_end DATETIME NOT NULL,
                next_billing_date DATETIME NOT NULL,
                trial_ends_at DATETIME,
                cancelled_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE ON UPDATE CASCADE
            )
        `);

        console.log('subscriptions table created successfully!');

        // Create invoices table
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                subscription_id TEXT NOT NULL,
                shop_id TEXT NOT NULL,
                invoice_number TEXT NOT NULL UNIQUE,
                billing_period TEXT NOT NULL,
                invoice_type TEXT NOT NULL DEFAULT 'Monthly subscription',
                amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                extra_usage_amount DECIMAL(10,2) DEFAULT 0,
                addon_amount DECIMAL(10,2) DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                due_date DATETIME NOT NULL,
                paid_at DATETIME,
                payment_method TEXT,
                transaction_id TEXT,
                notes TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE ON UPDATE CASCADE,
                FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE ON UPDATE CASCADE
            )
        `);

        console.log('invoices table created successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error creating subscription tables:', error);
        process.exit(1);
    }
};

createSubscriptionTables();
