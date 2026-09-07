const up = async (sequelize) => {
    await sequelize.query(
        'ALTER TABLE "messages" DROP COLUMN IF EXISTS "updated_at"',
    );
};

const down = async (sequelize) => {
    await sequelize.query(
        'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    );
};

module.exports = {
    name: '20260908_001_remove_messages_updated_at',
    up,
    down,
};
