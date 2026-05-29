require('module-alias/register');
const config = require('../../config/config');

const { sequelize } = require('./database-setup');
const entities = require('../../modules/entities');

const syncDatabase = async () => {
    try {
        // Plain sync (CREATE TABLE IF NOT EXISTS) — db:sync only runs against a
        // freshly-dropped database in the deploy WIPE path, where there is
        // nothing to alter. `alter: true` is avoided because Sequelize emits
        // malformed enum-change DDL (ALTER ... USING (col::enum)) that aborts
        // the whole sync on Postgres. Incremental schema changes go through
        // migrations, not db:sync.
        await sequelize.sync();
        console.log('Database synchronized successfully (tables created).');
        process.exit(0);
    } catch (error) {
        console.error('Error synchronizing database:', error);
        process.exit(1);
    }
};

syncDatabase();
