/**
 * Migration: 20260524_001_reencrypt_meta_channel_tokens
 *
 * Phase 2 — re-encrypt all meta_channels.page_access_token_ct values that are
 * still in the legacy 3-segment format into the v2 versioned format.
 *
 * Why this matters:
 *   Phase 1 backfilled `page_access_token_ct` straight from
 *   `meta_integrations.access_token`. Those ciphertexts were produced by
 *   integration/meta.service.js#encryptToken, which derives its key via
 *   crypto.scryptSync(CHANNEL_ENCRYPTION_KEY, 'salt', 32). The new cipher in
 *   meta-token-cipher.js derives its key via SHA-256 (or raw hex).
 *
 *   meta-token-cipher#decrypt has a scrypt fallback for legacy 3-segment
 *   ciphertexts, so reads keep working, but every read pays the scrypt cost.
 *   This migration eliminates that cost and normalises the on-disk format
 *   before Phase 3 flips META_READ_FROM_NEW=true.
 *
 * Idempotent: rows already in v2: format are skipped, so safe to re-run.
 *
 * Down-migration: the new ciphertexts cannot be decrypted back to the legacy
 * scrypt format without re-running through Meta OAuth, so this is irreversible.
 * Documented in plan.md as part of the dual-write rollback window closing.
 */

'use strict';

const cipher = require('../../utils/meta-token-cipher');

module.exports = {
    name: '20260524_001_reencrypt_meta_channel_tokens',

    up: async (sequelize) => {
        const dialect = sequelize.getDialect();
        if (dialect !== 'postgres') {
            console.warn('[migration] 20260524_001 skipped — requires PostgreSQL');
            return;
        }

        const [rows] = await sequelize.query(`
            SELECT id, page_access_token_ct
            FROM meta_channels
            WHERE page_access_token_ct IS NOT NULL
              AND page_access_token_ct NOT LIKE 'v2:%';
        `);

        if (rows.length === 0) {
            console.log('[migration] 20260524_001 — no legacy ciphertexts to re-encrypt');
            return;
        }

        console.log(`[migration] 20260524_001 — re-encrypting ${rows.length} legacy token(s)`);

        let converted = 0;
        let failed = 0;

        for (const row of rows) {
            try {
                const plaintext = cipher.decrypt(row.page_access_token_ct);
                const v2 = cipher.encrypt(plaintext);

                await sequelize.query(
                    `UPDATE meta_channels
                       SET page_access_token_ct = :ct,
                           updated_at = NOW()
                     WHERE id = :id;`,
                    { replacements: { ct: v2, id: row.id } }
                );

                converted += 1;
            } catch (err) {
                failed += 1;
                // Mark as ERROR so the operator notices, but don't blow up the
                // whole migration — one un-decryptable row should not block
                // the rest of the fleet.
                console.error(
                    `[migration] 20260524_001 — failed to re-encrypt meta_channels.id=${row.id}: ${err.message}`
                );
                await sequelize.query(
                    `UPDATE meta_channels
                       SET status = 'ERROR'::enum_meta_channels_status,
                           last_error = :err,
                           updated_at = NOW()
                     WHERE id = :id;`,
                    {
                        replacements: {
                            id: row.id,
                            err: `Token re-encryption failed during 20260524_001: ${err.message}`,
                        },
                    }
                );
            }
        }

        console.log(
            `[migration] 20260524_001 — done. converted=${converted} failed=${failed}`
        );

        if (failed > 0) {
            // Surface the failure count but don't reject the migration —
            // affected rows are flagged ERROR and require reconnect anyway.
            console.warn(
                `[migration] 20260524_001 — ${failed} row(s) marked status=ERROR; sellers will need to reconnect`
            );
        }
    },

    down: async (_sequelize) => {
        // Irreversible: scrypt-format ciphertexts cannot be reconstructed from
        // v2 ciphertexts without the original plaintext, and we deliberately
        // do not persist plaintext anywhere. To roll back, reconnect channels
        // via OAuth which will write fresh legacy ciphertexts through the
        // dual-write path.
        console.warn(
            '[migration] 20260524_001 down — no-op (irreversible). Reconnect channels via OAuth to repopulate.'
        );
    },
};
