require('module-alias/register');
const { sequelize } = require('src/utils/database/database-setup');

const columns = [
    'order_number TEXT',
    'customer_name TEXT',
    'customer_phone TEXT',
    "channel TEXT DEFAULT 'manual'",
    "order_status TEXT DEFAULT 'draft'",
    "payment_status TEXT DEFAULT 'pending'",
    "fulfillment_status TEXT DEFAULT 'unfulfilled'",
    'discount DECIMAL(10,2) DEFAULT 0',
    'tax DECIMAL(10,2) DEFAULT 0',
    'delivery_fee DECIMAL(10,2) DEFAULT 0',
    'delivery_address TEXT',
    'delivery_provider TEXT',
    'delivery_consignment_id TEXT',
    'delivery_tracking_code TEXT',
    'delivery_status TEXT',
    'delivery_dispatched_at DATETIME',
    'note TEXT'
];

(async () => {
    try {
        await sequelize.query('PRAGMA foreign_keys = OFF');
        for (const col of columns) {
            const name = col.split(' ')[0];
            try {
                await sequelize.query(`ALTER TABLE orders ADD COLUMN ${col}`);
                console.log('Added:', name);
            } catch (e) {
                if (e.message.includes('duplicate')) {
                    console.log('Exists:', name);
                } else {
                    console.log('Skip:', name, e.message);
                }
            }
        }
        await sequelize.query('PRAGMA foreign_keys = ON');
        console.log('Migration complete');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
