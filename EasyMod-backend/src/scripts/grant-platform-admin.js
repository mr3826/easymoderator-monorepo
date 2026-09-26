'use strict';

/**
 * Grant/revoke an EasyModerator platform admin role.
 *
 * Usage:
 *   GITHUB_ACTOR=<dispatching-operator> \
 *     node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>
 *
 * NONE clears the role (revokes admin access). Every role mutation is audited
 * under a serialized advisory lock, invalidates the target's live sessions
 * transactionally, and re-confirms the 60-second platform-role cache after
 * commit so a revoked admin cannot retain cached privilege.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const cacheService = require('../utils/cache.service');
const AuditService = require('../modules/audit/audit.service');
const { invalidateUserSessions } = require('../modules/auth/session-invalidation.service');
const { closeAllRedis } = require('../config/redis');

const VALID = ['SUPPORT_ADMIN', 'SUPER_ADMIN', 'NONE'];
const AUDIT_ACTION = 'platform:admin_role_changed';
const AUDIT_RESOURCE_TYPE = 'PLATFORM_ADMIN';
const LOCK_KEY = 'easymod:platform-admin:grant';

function cliError(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

async function reconfirmCache(cacheKey, value) {
  const confirmed = typeof cacheService.setStrict === 'function'
    ? await cacheService.setStrict(cacheKey, value, 60)
    : await cacheService.set(cacheKey, value, 60).then(() => true);
  if (confirmed !== true) {
    throw cliError(
      'FAIL: platform_role cache could not be re-confirmed; the change is committed but cached privilege may persist for up to 60 seconds. Re-run to converge.',
      4,
    );
  }
}

const USAGE = 'Usage: node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>';

function resolveGithubActor() {
  const actor = String(process.env.GITHUB_ACTOR || '').trim();
  return /^[A-Za-z0-9_.-]{1,100}$/.test(actor) ? actor : 'unknown';
}

async function run(args) {
  const [email, roleArg] = args;
  if (!email || !roleArg || !VALID.includes(roleArg)) {
    throw cliError(USAGE);
  }
  const role = roleArg === 'NONE' ? null : roleArg;
  const githubActor = resolveGithubActor();

  await sequelize.authenticate();
  try {
    const outcome = await sequelize.transaction(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:lockKey))', {
        bind: { lockKey: LOCK_KEY },
        transaction,
      });
      const user = await User.findOne({
        where: { email },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user) {
        throw cliError(`No user found with email ${email}`, 2);
      }
      const previousRole = user.platform_role || null;
      if (previousRole === role) {
        return { user, previousRole, noop: true };
      }
      await user.update({ platform_role: role }, { transaction });
      await AuditService.logOperation({
        userId: null,
        shopId: null,
        action: AUDIT_ACTION,
        resourceType: AUDIT_RESOURCE_TYPE,
        resourceId: user.id,
        oldValues: { platform_role: previousRole },
        newValues: { platform_role: role },
        metadata: {
          source: 'protected_grant_platform_admin_workflow',
          github_actor: githubActor,
          result: 'success',
        },
      }, { transaction, required: true });
      // Privilege changes must not survive on already-issued tokens.
      await invalidateUserSessions(user.id, { transaction });
      return { user, previousRole, noop: false };
    });

    // The cache re-confirmation also runs on the NOOP path so an operator's
    // "re-run to converge" after an exit-4 response actually converges even
    // if a previous crash left a stale privileged cache within its 60s TTL.
    const cacheKey = `user:${outcome.user.id}:platform_role`;
    if (outcome.noop) {
      await reconfirmCache(cacheKey, outcome.previousRole || 'NONE');
      return { noop: true, email, role: outcome.previousRole };
    }
    await reconfirmCache(cacheKey, role || 'NONE');
    return { noop: false, email, userId: outcome.user.id, role };
  } finally {
    await sequelize.close().catch(() => {});
    await closeAllRedis().catch(() => {});
  }
}

async function main(args = process.argv.slice(2)) {
  const result = await run(args);
  if (result.noop) {
    console.log(`NOCHANGE: ${result.email} already holds platform_role ${result.role || 'NONE'}`);
  } else {
    console.log(`OK: ${result.email} platform_role => ${result.role || 'NONE (revoked)'} (user ${result.userId})`);
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exit(err.exitCode || 3); });
}

module.exports = {
  AUDIT_ACTION,
  AUDIT_RESOURCE_TYPE,
  LOCK_KEY,
  USAGE,
  VALID,
  main,
  run,
};
