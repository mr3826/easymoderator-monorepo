/**
 * Script to add token_version column to users table
 * Run: node src/scripts/add-token-version.js
 */
const { sequelize } = require('../utils/database/database-setup');

async function addTokenVersionColumn() {
    try {
        console.log('🔧 Adding token_version column to users table...');

        // Check if column already exists
        const [columns] = await sequelize.query(
            "PRAGMA table_info(users);",
            { type: sequelize.QueryTypes.SELECT }
        );

        const hasTokenVersion = Array.isArray(columns)
            ? columns.some(col => col.name === 'token_version')
            : false;

        if (hasTokenVersion) {
            console.log('✅ token_version column already exists');
            return;
        }

        // Add the column
        await sequelize.query(
            `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;`
        );

        console.log('✅ Successfully added token_version column to users table');
        console.log('📊 All existing users now have token_version = 1');

    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('✅ token_version column already exists');
        } else {
            console.error('❌ Error adding token_version column:', error.message);
            process.exit(1);
        }
    } finally {
        await sequelize.close();
    }
}

addTokenVersionColumn();
