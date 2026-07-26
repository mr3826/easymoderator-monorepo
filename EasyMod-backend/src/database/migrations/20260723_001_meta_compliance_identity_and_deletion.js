'use strict';

module.exports = {
    name: '20260723_001_meta_compliance_identity_and_deletion',

    up: async (sequelize) => {
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_user_identities (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_scoped_user_id VARCHAR(128) NOT NULL,
                page_scoped_user_id VARCHAR(128),
                internal_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                channel_id UUID NOT NULL REFERENCES meta_channels(id) ON DELETE CASCADE,
                source VARCHAR(32) NOT NULL DEFAULT 'facebook_oauth',
                is_current_connection BOOLEAN NOT NULL DEFAULT FALSE,
                last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`
            ALTER TABLE meta_user_identities
            ADD COLUMN IF NOT EXISTS is_current_connection BOOLEAN NOT NULL DEFAULT FALSE;
        `);
        // Draft deployments may already contain identity rows. Mark only the
        // newest row current when a channel has no explicit current mapping.
        await sequelize.query(`
            WITH newest_per_channel AS (
                SELECT DISTINCT ON (channel_id) id
                FROM meta_user_identities identities
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM meta_user_identities current_identity
                    WHERE current_identity.channel_id = identities.channel_id
                      AND current_identity.is_current_connection = TRUE
                )
                ORDER BY channel_id, last_verified_at DESC, created_at DESC, id DESC
            )
            UPDATE meta_user_identities
            SET is_current_connection = TRUE
            WHERE id IN (SELECT id FROM newest_per_channel);
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_user_identities_app_channel
            ON meta_user_identities(app_scoped_user_id, channel_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_user_identities_shop_psid
            ON meta_user_identities(shop_id, page_scoped_user_id);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_user_identities_internal_user
            ON meta_user_identities(internal_user_id);
        `);
        await sequelize.query(`
            WITH ranked_current AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY channel_id
                           ORDER BY last_verified_at DESC, created_at DESC, id DESC
                       ) AS current_rank
                FROM meta_user_identities
                WHERE is_current_connection = TRUE
            )
            UPDATE meta_user_identities identities
            SET is_current_connection = FALSE
            FROM ranked_current ranked
            WHERE identities.id = ranked.id
              AND ranked.current_rank > 1;
        `);
        await sequelize.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_user_identities_current_channel
            ON meta_user_identities(channel_id)
            WHERE is_current_connection = TRUE;
        `);

        await sequelize.query(`
            DO $$ BEGIN
                CREATE TYPE enum_meta_data_deletion_requests_status
                    AS ENUM (
                        'PENDING',
                        'PROCESSING',
                        'IDENTITY_NOT_RESOLVED',
                        'COMPLETED',
                        'FAILED'
                    );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        `);
        // Keeps up() re-runnable if an earlier draft of this migration created
        // the enum before IDENTITY_NOT_RESOLVED was introduced.
        await sequelize.query(`
            ALTER TYPE enum_meta_data_deletion_requests_status
            ADD VALUE IF NOT EXISTS 'IDENTITY_NOT_RESOLVED';
        `);
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS meta_data_deletion_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                request_fingerprint VARCHAR(64) NOT NULL UNIQUE,
                identity_hash VARCHAR(64) NOT NULL,
                confirmation_code_hash VARCHAR(64) NOT NULL UNIQUE,
                status enum_meta_data_deletion_requests_status NOT NULL DEFAULT 'PENDING',
                matched_customer_count INTEGER NOT NULL DEFAULT 0,
                conversations_deleted_count INTEGER NOT NULL DEFAULT 0,
                messages_deleted_count INTEGER NOT NULL DEFAULT 0,
                orders_anonymized_count INTEGER NOT NULL DEFAULT 0,
                attachments_deleted_count INTEGER NOT NULL DEFAULT 0,
                pending_attachment_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
                failure_code VARCHAR(64),
                failure_detail VARCHAR(255),
                processing_token VARCHAR(64),
                started_at TIMESTAMPTZ,
                data_phase_completed_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await sequelize.query(`
            ALTER TABLE meta_data_deletion_requests
            ADD COLUMN IF NOT EXISTS processing_token VARCHAR(64);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_deletion_identity_hash
            ON meta_data_deletion_requests(identity_hash);
        `);
        await sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_meta_deletion_status_created
            ON meta_data_deletion_requests(status, created_at);
        `);

        console.log('[migration] 20260723_001_meta_compliance_identity_and_deletion: UP complete');
    },

    down: async (sequelize) => {
        await sequelize.query('DROP TABLE IF EXISTS meta_data_deletion_requests;');
        await sequelize.query('DROP TYPE IF EXISTS enum_meta_data_deletion_requests_status;');
        await sequelize.query('DROP TABLE IF EXISTS meta_user_identities;');
        console.log('[migration] 20260723_001_meta_compliance_identity_and_deletion: DOWN complete');
    },
};
