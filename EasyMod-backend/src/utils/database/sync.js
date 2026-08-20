require('module-alias/register');
const config = require('../../config/config');

const { sequelize } = require('./database-setup');
require('../../modules/entities');
const growthProspectMigration = require('../../database/migrations/20260820_002_growth_os_prospects');

const syncDatabase = async () => {
    try {
        // Plain sync (CREATE TABLE IF NOT EXISTS) — db:sync only runs against a
        // freshly-dropped database in the deploy WIPE path, where there is
        // nothing to alter. Prospect entities remain lazy here so Sequelize
        // cannot create their tables without the migration's CHECK constraints.
        // `alter: true` is avoided because Sequelize emits malformed enum-change
        // DDL (ALTER ... USING (col::enum)) that aborts the whole sync on Postgres.
        await sequelize.sync();
        await growthProspectMigration.up(sequelize);
        console.log('Database synchronized successfully (tables created).');
        process.exit(0);
    } catch (error) {
        console.error('Error synchronizing database:', error);
        process.exit(1);
    }
};

syncDatabase();
