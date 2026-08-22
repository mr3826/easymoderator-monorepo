'use strict';

const STATUSES = [
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'disqualified',
  'unreachable',
  'converted',
  'merged',
];

const SOURCES = [
  'self_signup',
  'partner_form',
  'manual_entry',
  'referral_mention',
  'inbound_message',
  'event',
  'other',
];

const EVENT_TYPES = [
  'created',
  'updated',
  'status_changed',
  'assigned',
  'unassigned',
  'linked',
  'unlinked',
  'merged',
  'merge_target',
  'imported',
];

const quote = (values) => values.map((value) => `'${value}'`).join(', ');

module.exports = {
  name: '20260820_002_growth_os_prospects',

  up: async (sequelize) => {
    const transaction = await sequelize.transaction();
    const postgres = sequelize.getDialect() === 'postgres';
    const uuid = postgres ? 'UUID' : 'TEXT';
    const uuidDefault = postgres ? ' DEFAULT gen_random_uuid()' : '';
    const timestamp = postgres ? 'TIMESTAMPTZ' : 'DATETIME';
    const jsonb = postgres ? 'JSONB' : 'TEXT';
    const jsonObjectDefault = postgres ? "'{}'::jsonb" : "'{}'";
    const jsonArrayDefault = postgres ? "'[]'::jsonb" : "'[]'";

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS growth_os_prospects (
          id ${uuid}${uuidDefault} PRIMARY KEY,
          business_name VARCHAR(255) NOT NULL,
          contact_name VARCHAR(255),
          contact_phone VARCHAR(32),
          contact_email VARCHAR(255),
          page_url TEXT,
          niche VARCHAR(120),
          notes TEXT,
          normalized_business_name VARCHAR(255) NOT NULL,
          normalized_phone VARCHAR(32),
          normalized_email VARCHAR(255),
          normalized_page VARCHAR(255),
          source VARCHAR(32) NOT NULL,
          source_detail VARCHAR(160),
          source_reference VARCHAR(255),
          source_recorded_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
          status VARCHAR(24) NOT NULL DEFAULT 'new',
          status_changed_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
          disqualified_reason VARCHAR(200),
          owner_user_id ${uuid} REFERENCES users(id) ON DELETE SET NULL,
          assigned_at ${timestamp},
          assigned_by ${uuid} REFERENCES users(id) ON DELETE SET NULL,
          linked_shop_id ${uuid} REFERENCES shops(id) ON DELETE SET NULL,
          linked_user_id ${uuid} REFERENCES users(id) ON DELETE SET NULL,
          linked_at ${timestamp},
          merged_into_id ${uuid} REFERENCES growth_os_prospects(id) ON DELETE SET NULL,
          merged_at ${timestamp},
          created_by ${uuid} REFERENCES users(id) ON DELETE SET NULL,
          metadata ${jsonb} NOT NULL DEFAULT ${jsonObjectDefault},
          created_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
          updated_at ${timestamp} NOT NULL DEFAULT ${postgres ? 'NOW()' : 'CURRENT_TIMESTAMP'},
          CONSTRAINT growth_os_prospects_status_check CHECK (status IN (${quote(STATUSES)})),
          CONSTRAINT growth_os_prospects_source_check CHECK (source IN (${quote(SOURCES)})),
          CONSTRAINT growth_os_prospects_merge_check CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
          CONSTRAINT growth_os_prospects_converted_link_check CHECK (status <> 'converted' OR linked_shop_id IS NOT NULL),
          CONSTRAINT growth_os_prospects_channel_check CHECK (
            normalized_phone IS NOT NULL OR normalized_email IS NOT NULL OR normalized_page IS NOT NULL
          )
        );
      `, { transaction });

      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS growth_os_prospect_events (
          id ${uuid}${uuidDefault} PRIMARY KEY,
          prospect_id ${uuid} NOT NULL REFERENCES growth_os_prospects(id) ON DELETE CASCADE,
          event_type VARCHAR(32) NOT NULL,
          actor_user_id ${uuid} REFERENCES users(id) ON DELETE SET NULL,
          from_value VARCHAR(64),
          to_value VARCHAR(64),
          reason VARCHAR(200),
          changed_fields ${jsonb} NOT NULL DEFAULT ${jsonArrayDefault},
          metadata ${jsonb} NOT NULL DEFAULT ${jsonObjectDefault},
          created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT growth_os_prospect_events_type_check CHECK (event_type IN (${quote(EVENT_TYPES)}))
        );
      `, { transaction });

      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_status_created_idx ON growth_os_prospects (status, created_at DESC);',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_owner_status_created_idx ON growth_os_prospects (owner_user_id, status, created_at DESC);',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_source_created_idx ON growth_os_prospects (source, created_at DESC);',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_normalized_business_name_idx ON growth_os_prospects (normalized_business_name);',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_linked_shop_idx ON growth_os_prospects (linked_shop_id) WHERE linked_shop_id IS NOT NULL;',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospects_merged_into_idx ON growth_os_prospects (merged_into_id) WHERE merged_into_id IS NOT NULL;',
        { transaction },
      );
      await sequelize.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS growth_os_prospects_normalized_phone_uq ON growth_os_prospects (normalized_phone) WHERE normalized_phone IS NOT NULL AND status <> 'merged';",
        { transaction },
      );
      await sequelize.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS growth_os_prospects_normalized_email_uq ON growth_os_prospects (normalized_email) WHERE normalized_email IS NOT NULL AND status <> 'merged';",
        { transaction },
      );
      await sequelize.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS growth_os_prospects_normalized_page_uq ON growth_os_prospects (normalized_page) WHERE normalized_page IS NOT NULL AND status <> 'merged';",
        { transaction },
      );
      await sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS growth_os_prospects_source_reference_uq ON growth_os_prospects (source, source_reference) WHERE source_reference IS NOT NULL;',
        { transaction },
      );
      await sequelize.query(
        'CREATE INDEX IF NOT EXISTS growth_os_prospect_events_prospect_created_idx ON growth_os_prospect_events (prospect_id, created_at DESC);',
        { transaction },
      );

      await transaction.commit();
      console.log('[migration] 20260820_002_growth_os_prospects: UP complete');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (sequelize) => {
    const transaction = await sequelize.transaction();
    try {
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospect_events_prospect_created_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_source_reference_uq;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_normalized_page_uq;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_normalized_email_uq;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_normalized_phone_uq;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_merged_into_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_linked_shop_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_normalized_business_name_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_source_created_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_owner_status_created_idx;', { transaction });
      await sequelize.query('DROP INDEX IF EXISTS growth_os_prospects_status_created_idx;', { transaction });
      await sequelize.query('DROP TABLE IF EXISTS growth_os_prospect_events;', { transaction });
      await sequelize.query('DROP TABLE IF EXISTS growth_os_prospects;', { transaction });
      await transaction.commit();
      console.log('[migration] 20260820_002_growth_os_prospects: DOWN complete');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
