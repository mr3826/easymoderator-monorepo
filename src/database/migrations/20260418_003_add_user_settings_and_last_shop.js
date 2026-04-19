'use strict';

/**
 * Migration: Add missing columns to users table
 *
 * - settings          JSON nullable  — user preferences / TOTP config
 * - last_logged_shop_id UUID nullable — last shop the user was active in
 *
 * Both were added to user.entity.js after the initial table was created by
 * sequelize.sync(). Production DB never received them — causing
 * "column User.settings does not exist" on sign-in.
 */

module.exports = {
  name: '20260418_003_add_user_settings_and_last_shop',

  up: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    const alreadyExists = (e) =>
      /constraint|already exists|duplicate|column.*already/i.test(e.message);

    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'`);
      console.log('  ✓ users.settings added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · users.settings already exists, skipping');
      } else {
        throw err;
      }
    }

    try {
      await qi.addColumn('users', 'last_logged_shop_id', {
        type: 'UUID',
        allowNull: true,
      });
      console.log('  ✓ users.last_logged_shop_id added');
    } catch (err) {
      if (alreadyExists(err)) {
        console.log('  · users.last_logged_shop_id already exists, skipping');
      } else {
        throw err;
      }
    }
  },

  down: async (sequelize) => {
    const qi = sequelize.getQueryInterface();
    try { await qi.removeColumn('users', 'settings'); } catch (_) {}
    try { await qi.removeColumn('users', 'last_logged_shop_id'); } catch (_) {}
  },
};
