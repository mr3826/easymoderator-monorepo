const hasUpdatedAtColumn = async (sequelize) => {
    const dialect = typeof sequelize.getDialect === 'function'
        ? sequelize.getDialect()
        : 'postgres';

    if (dialect === 'postgres') {
        const [rows] = await sequelize.query(`
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'messages'
               AND column_name = 'updated_at'
             LIMIT 1
        `);
        return rows.length > 0;
    }

    const [rows] = await sequelize.query('PRAGMA table_info("messages")');
    return rows.some((row) => row.name === 'updated_at');
};

const up = async (sequelize) => {
    await sequelize.query(
        'ALTER TABLE "messages" DROP COLUMN IF EXISTS "updated_at"',
    );
};

const down = async (sequelize) => {
    if (await hasUpdatedAtColumn(sequelize)) return;

    // This migration did not persist whether the column existed before up();
    // recreating it with NOW() would fabricate timestamps for every message.
    throw new Error(
        'Rollback blocked: 20260908_001 removed messages.updated_at and its historical values cannot be reconstructed safely; restore a backup or ship a reviewed forward migration.',
    );
};

module.exports = {
    name: '20260908_001_remove_messages_updated_at',
    up,
    down,
};
