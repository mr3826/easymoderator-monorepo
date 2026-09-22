'use strict';

/**
 * Migration: 20260913_001_courier_dispatch_order_scope
 *
 * Problem:
 *   courier_dispatch enforces UNIQUE(shop_id, order_id, provider). Because
 *   `provider` is part of the key, calling claimCourierDispatch() with two
 *   DIFFERENT providers for the SAME order creates two independent claim
 *   rows instead of the second one being blocked — nothing in that key stops
 *   a second, different courier from being booked for an order that already
 *   has an active/committed dispatch with a first courier. See
 *   src/modules/delivery/courier-dispatch-claim.service.js for the paired
 *   code fix: the claim is now looked up by (shop_id, order_id) only, with
 *   `provider` moved into the row's stored data rather than its identity.
 *
 * Pre-flight / data safety (read before running this against real data):
 *   This tightens the unique constraint, so any (shop_id, order_id) pair that
 *   already has more than one row — i.e. this very bug already fired for
 *   that order — would violate the new index. This migration was authored
 *   without access to production data, so whether that has already happened
 *   is unverified. Rather than assume either way, it defends against the
 *   worst case:
 *
 *     1. For every (shop_id, order_id) with more than one row, rank rows by
 *        (status = 'COMMITTED') DESC, created_at ASC, id ASC — i.e. prefer a
 *        COMMITTED row (a real courier booking) over a PENDING/FAILED/
 *        INDETERMINATE one, and prefer the earliest as a tie-break.
 *     2. Every row that is NOT rank 1 is copied — never just deleted — into a
 *        new audit table, courier_dispatch_order_scope_conflicts, stamped
 *        with when and by which migration it was moved.
 *     3. Those rows are then removed from courier_dispatch so the tighter
 *        unique index can be created.
 *
 *   A moved row with status = 'COMMITTED' is not a cosmetic duplicate — it
 *   means two different couriers were actually booked for the same order
 *   before this fix shipped. This migration does not decide which physical
 *   shipment is legitimate and never discards the losing row's
 *   consignment_id/tracking_code. If the up() log reports any COMMITTED
 *   conflict, a human must inspect
 *   courier_dispatch_order_scope_conflicts and reconcile with the courier(s)
 *   involved (likely cancelling the duplicate booking) before treating this
 *   migration as fully closed out.
 *
 * Forward-only:
 *   Consistent with this migration set's other structural changes (see
 *   20260828_004_commercial_model.js), down() reverses the index change only.
 *   It does not re-merge conflict rows back into courier_dispatch — doing so
 *   automatically could silently recreate the exact ambiguity this migration
 *   exists to resolve. The conflicts table is left in place either way, so
 *   no data is lost by rolling back.
 */
module.exports = {
    name: '20260913_001_courier_dispatch_order_scope',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS courier_dispatch_order_scope_conflicts (
                id                   UUID PRIMARY KEY,
                shop_id              UUID NOT NULL,
                order_id             UUID NOT NULL,
                provider             VARCHAR(50) NOT NULL,
                idempotency_key      VARCHAR(64) NOT NULL,
                status               VARCHAR(30) NOT NULL,
                consignment_id       VARCHAR(120),
                tracking_code        VARCHAR(120),
                error                TEXT,
                dispatch_owner_token VARCHAR(64),
                created_at           TIMESTAMPTZ NOT NULL,
                updated_at           TIMESTAMPTZ NOT NULL,
                moved_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                moved_by_migration   VARCHAR(255) NOT NULL DEFAULT '20260913_001_courier_dispatch_order_scope'
            );
        `);

        const rankedSql = `
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY shop_id, order_id
                       ORDER BY (status = 'COMMITTED') DESC, created_at ASC, id ASC
                   ) AS rn
            FROM courier_dispatch
        `;

        const [superseded] = await sequelize.query(`
            SELECT id FROM (${rankedSql}) ranked WHERE rn > 1;
        `);

        if (superseded.length > 0) {
            console.warn(
                `[migration 20260913_001] WARNING: ${superseded.length} courier_dispatch row(s) `
                + 'share a (shop_id, order_id) with another row — this is the cross-provider '
                + 'double-booking bug this migration fixes. Moving the superseded row(s) to '
                + 'courier_dispatch_order_scope_conflicts for manual review before tightening '
                + 'the unique index.'
            );

            await sequelize.query(`
                INSERT INTO courier_dispatch_order_scope_conflicts (
                    id, shop_id, order_id, provider, idempotency_key, status,
                    consignment_id, tracking_code, error, dispatch_owner_token,
                    created_at, updated_at
                )
                SELECT cd.id, cd.shop_id, cd.order_id, cd.provider, cd.idempotency_key, cd.status,
                       cd.consignment_id, cd.tracking_code, cd.error, cd.dispatch_owner_token,
                       cd.created_at, cd.updated_at
                FROM courier_dispatch cd
                WHERE cd.id IN (SELECT id FROM (${rankedSql}) ranked WHERE rn > 1)
                ON CONFLICT (id) DO NOTHING;
            `);

            const [committedConflicts] = await sequelize.query(`
                SELECT COUNT(*)::int AS count
                FROM courier_dispatch_order_scope_conflicts
                WHERE status = 'COMMITTED';
            `);
            if ((committedConflicts[0]?.count || 0) > 0) {
                console.warn(
                    `[migration 20260913_001] WARNING: ${committedConflicts[0].count} of the moved `
                    + 'row(s) were COMMITTED — an order may already have two real courier bookings. '
                    + 'Check courier_dispatch_order_scope_conflicts and reconcile with the courier(s) '
                    + 'manually.'
                );
            }

            await sequelize.query(`
                DELETE FROM courier_dispatch
                WHERE id IN (SELECT id FROM (${rankedSql}) ranked WHERE rn > 1);
            `);
        }

        await sequelize.query(`DROP INDEX IF EXISTS idx_courier_dispatch_shop_order_provider;`);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_courier_dispatch_shop_order
                ON courier_dispatch(shop_id, order_id);
        `);
    },

    down: async (sequelize) => {
        await sequelize.query(`DROP INDEX IF EXISTS idx_courier_dispatch_shop_order;`);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_courier_dispatch_shop_order_provider
                ON courier_dispatch(shop_id, order_id, provider);
        `);
    },
};
