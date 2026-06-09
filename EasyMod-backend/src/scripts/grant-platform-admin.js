'use strict';

/**
 * Grant/revoke an EasyModerator platform admin role.
 *
 * Usage:
 *   node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>
 *
 * NONE clears the role (revokes admin access). Busts the 60s role cache so the
 * change takes effect immediately.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const cacheService = require('../utils/cache.service');

const VALID = ['SUPPORT_ADMIN', 'SUPER_ADMIN', 'NONE'];

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  if (!email || !roleArg || !VALID.includes(roleArg)) {
    console.error('Usage: node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>');
    process.exit(1);
  }
  const role = roleArg === 'NONE' ? null : roleArg;

  await sequelize.authenticate();
  const user = await User.findOne({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(2);
  }
  await user.update({ platform_role: role });
  await cacheService.set(`user:${user.id}:platform_role`, role || 'NONE', 60).catch(() => {});

  console.log(`OK: ${email} platform_role => ${role || 'NONE (revoked)'} (user ${user.id})`);
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(3); });
