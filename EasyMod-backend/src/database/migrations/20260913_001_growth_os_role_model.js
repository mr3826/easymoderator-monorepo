'use strict';

// Widen the Growth OS role CHECK to the canonical two-role model
// (SUPER_ADMIN / GROWTH_USER) while keeping every legacy value valid for
// historical rows. No rows are rewritten by this migration; legacy->canonical
// resolution happens in code (growth-os.permissions ROLE_ALIASES).
// This is intentionally additive: no database surgery on existing grants.

const ROLES = [
  'SUPER_ADMIN',
  'GROWTH_USER',
  'FOUNDER',
  'GROWTH_MANAGER',
  'BUSINESS_EXECUTIVE',
  'MARKETER',
  'CUSTOMER_SUCCESS',
  'READ_ONLY_ANALYST',
];

const LEGACY_ROLES = [
  'FOUNDER',
  'GROWTH_MANAGER',
  'BUSINESS_EXECUTIVE',
  'MARKETER',
  'CUSTOMER_SUCCESS',
  'READ_ONLY_ANALYST',
];

const quote = (values) => values.map((value) => `'${value}'`).join(', ');

module.exports = {
  name: '20260913_001_growth_os_role_model',
  async up(sequelize) {
    if (sequelize.getDialect() !== 'postgres') {
      console.log('[20260913_001] named CHECK replacement skipped on non-PostgreSQL dialect');
      return;
    }
    await sequelize.query(
      `ALTER TABLE growth_os_user_roles
         DROP CONSTRAINT IF EXISTS growth_os_user_roles_role_check`,
    );
    await sequelize.query(
      `ALTER TABLE growth_os_user_roles
         ADD CONSTRAINT growth_os_user_roles_role_check
         CHECK (role IN (${quote(ROLES)}))`,
    );
  },

  async down(sequelize) {
    if (sequelize.getDialect() !== 'postgres') return;
    const [{ count }] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM growth_os_user_roles
        WHERE role NOT IN (${quote(LEGACY_ROLES)})`,
      { plain: false },
    );
    if (Number(count) > 0) {
      throw new Error(
        'Cannot roll back: canonical Growth OS role rows exist (count=' + count + ')',
      );
    }
    await sequelize.query(
      `ALTER TABLE growth_os_user_roles
         DROP CONSTRAINT IF EXISTS growth_os_user_roles_role_check`,
    );
    await sequelize.query(
      `ALTER TABLE growth_os_user_roles
         ADD CONSTRAINT growth_os_user_roles_role_check
         CHECK (role IN (${quote(LEGACY_ROLES)}))`,
    );
  },
};
