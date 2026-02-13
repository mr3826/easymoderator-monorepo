require('module-alias/register');
const { sequelize } = require('src/utils/database/database-setup');

const columns = [
    'is_active BOOLEAN DEFAULT 1',
    'sku TEXT',
    'quantity INTEGER DEFAULT 0',
    'track_quantity BOOLEAN DEFAULT 0',
    'low_stock_threshold INTEGER DEFAULT 5',
    'send_low_stock_alert BOOLEAN DEFAULT 0',
    'allow_discounts BOOLEAN DEFAULT 1',
    'charge_tax BOOLEAN DEFAULT 0',
    "variants TEXT DEFAULT '[]'",
    'brand TEXT',
    'weight DECIMAL(10,3)',
    'weight_unit TEXT',
    'compare_at_price DECIMAL(10,2)',
    'cost_per_item DECIMAL(10,2)',
    'category_id TEXT'
];

(async () => {
    try {
        await sequelize.query('PRAGMA foreign_keys = OFF');
        for (const col of columns) {
            const name = col.split(' ')[0];
            try {
                await sequelize.query(`ALTER TABLE products ADD COLUMN ${col}`);
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
