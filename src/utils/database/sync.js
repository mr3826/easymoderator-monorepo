require('module-alias/register');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { sequelize } = require('src/utils/database/database-setup');
const entities = require('src/modules/entities');

const syncDatabase = async () => {
    try {
        // Use alter to update schema without deleting data
        // This will add new columns, remove columns that don't exist in the model,
        // and change column types if needed, but will preserve existing data
        await sequelize.sync({ alter: true });
        console.log('Database synchronized successfully (schema updated, data preserved).');
        process.exit(0);
    } catch (error) {
        console.error('Error synchronizing database:', error);
        process.exit(1);
    }
};

syncDatabase();
