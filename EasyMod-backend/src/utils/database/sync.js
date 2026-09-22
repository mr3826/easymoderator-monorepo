require('module-alias/register');
const config = require('../../config/config');

    const { sequelize } = require('./database-setup');
require('../../modules/entities');
const missingProductionTablesMigration = require('../../database/migrations/20260816_001_create_missing_production_tables');
const schemaDriftMigration = require('../../database/migrations/20260611_003_schema_drift_sweep');
const courierClaimMigration = require('../../database/migrations/20260828_003_courier_dispatch_claim_owner');
const commercialMigration = require('../../database/migrations/20260828_004_commercial_model');
const commercialEntityDriftMigration = require('../../database/migrations/20260901_001_reconcile_commercial_entity_drift');
const inboxMessageDeliveryStateMigration = require('../../database/migrations/20260904_001_inbox_message_delivery_state');
const inboxDeliveryOutboxMigration = require('../../database/migrations/20260904_002_inbox_delivery_outbox');
const growthUserRoleMigration = require('../../database/migrations/20260820_001_growth_os_user_roles');
const growthProspectMigration = require('../../database/migrations/20260820_002_growth_os_prospects');
const growthProspectSourceReferenceMigration = require('../../database/migrations/20260820_003_growth_os_prospect_source_reference_idx');
const growthRoleModelMigration = require('../../database/migrations/20260913_001_growth_os_role_model');
const growthWorkflowMigration = require('../../database/migrations/20260913_002_growth_os_workflow_expansion');
const growthFollowupsMigration = require('../../database/migrations/20260913_003_growth_os_followups');
const growthNotesMigration = require('../../database/migrations/20260913_004_growth_os_notes');
const temporaryPasswordMigration = require('../../database/migrations/20260914_001_add_temporary_password_controls');

const syncDatabase = async () => {
    try {
        // Plain sync creates the entity-backed tables on a freshly-wiped
        // database. Do not run the historical migration chain here: several
        // early migrations expect columns that current entity sync intentionally
        // omits. Apply the migration-only schemas required by the current
        // runtime explicitly before the WIPE workflow primes migration history.
        await sequelize.sync();
        await missingProductionTablesMigration.up(sequelize);
        await schemaDriftMigration.up(sequelize);
        await courierClaimMigration.up(sequelize);
        await commercialMigration.up(sequelize);
        await commercialEntityDriftMigration.up(sequelize);
        await inboxMessageDeliveryStateMigration.up(sequelize);
        await inboxDeliveryOutboxMigration.up(sequelize);
        // The role check/index migration is PostgreSQL-specific. Entity sync
        // still creates the compatible model table for SQLite-based local runs.
        if (sequelize.getDialect() === 'postgres') {
            await growthUserRoleMigration.up(sequelize);
            await growthRoleModelMigration.up(sequelize);
        }
        await growthProspectMigration.up(sequelize);
        await growthProspectSourceReferenceMigration.up(sequelize);
        await growthWorkflowMigration.up(sequelize);
        await growthFollowupsMigration.up(sequelize);
        await growthNotesMigration.up(sequelize);
        await temporaryPasswordMigration.up(sequelize);
        console.log('Database synchronized and migrations applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error synchronizing database:', error);
        process.exit(1);
    }
};

syncDatabase();
