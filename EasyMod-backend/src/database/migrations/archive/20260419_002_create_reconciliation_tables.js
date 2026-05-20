module.exports = {
  name: '20260419_002_create_reconciliation_tables',

  up: async (sequelize) => {
    const dialect = sequelize.getDialect();

    // Records each courier payout batch claim
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS courier_cod_collections (
        id                  TEXT        PRIMARY KEY,
        shop_id             TEXT        NOT NULL,
        provider            TEXT        NOT NULL,
        payment_reference   TEXT        NOT NULL,
        claimed_amount      NUMERIC(12,2) NOT NULL,
        consignment_count   INTEGER     NOT NULL DEFAULT 0,
        consignment_ids     TEXT        NOT NULL DEFAULT '[]',
        payment_date        DATE        NOT NULL,
        raw_payload         TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Created courier_cod_collections table');

    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ccc_shop_ref
       ON courier_cod_collections(shop_id, provider, payment_reference)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_ccc_shop ON courier_cod_collections(shop_id)`
    );

    const disputeStatusEnum = dialect === 'sqlite'
      ? `TEXT NOT NULL DEFAULT 'open'`
      : `TEXT NOT NULL DEFAULT 'open' CHECK (dispute_status IN ('open','under_review','resolved','rejected'))`;

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_disputes (
        id                TEXT        PRIMARY KEY,
        shop_id           TEXT        NOT NULL,
        collection_id     TEXT        REFERENCES courier_cod_collections(id),
        provider          TEXT        NOT NULL,
        payment_reference TEXT        NOT NULL,
        claimed_amount    NUMERIC(12,2) NOT NULL,
        expected_amount   NUMERIC(12,2) NOT NULL,
        discrepancy_amount NUMERIC(12,2) NOT NULL,
        dispute_status    ${disputeStatusEnum},
        notes             TEXT,
        resolved_at       TIMESTAMPTZ,
        resolved_by       TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Created reconciliation_disputes table');

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_rd_shop ON reconciliation_disputes(shop_id)`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_rd_status ON reconciliation_disputes(dispute_status)`
    );
    console.log('  ✓ Created reconciliation indexes');
  },

  down: async (sequelize) => {
    await sequelize.query('DROP TABLE IF EXISTS reconciliation_disputes');
    await sequelize.query('DROP TABLE IF EXISTS courier_cod_collections');
    console.log('  ✓ Dropped reconciliation tables');
  }
};
