'use strict';

/**
 * Grant or revoke an EasyModerator Growth OS role.
 *
 * Usage:
 *   node src/scripts/grant-growth-role.js <email> <ROLE|NONE>
 *
 * The bootstrap workflow passes the target user as both actor and target. The
 * role service still owns the transaction, audit row, and cache invalidation.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const roleService = require('../modules/growth-os/growth-os.roles.service');
const { GROWTH_OS_ROLES } = require('../modules/growth-os/growth-os.permissions');

const VALID_ROLES = [...Object.values(GROWTH_OS_ROLES), 'NONE'];
const USAGE = 'Usage: node src/scripts/grant-growth-role.js <email> <ROLE|NONE>';
const BOOTSTRAP_REASON = 'Growth OS role bootstrap via CLI';

function cliError(message, exitCode = 1) {
    const error = new Error(message);
    error.exitCode = exitCode;
    return error;
}

function parseArguments(args) {
    const [email, role] = args;
    if (!email || !role || !VALID_ROLES.includes(role)) {
        throw cliError(USAGE);
    }
    return { email, role };
}

async function run(args = process.argv.slice(2)) {
    const { email, role } = parseArguments(args);

    await sequelize.authenticate();
    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            throw cliError(`No user found with email ${email}`, 2);
        }

        const roleArgs = {
            actorUserId: user.id,
            targetUserId: user.id,
            reason: BOOTSTRAP_REASON,
        };
        const result = role === 'NONE'
            ? await roleService.revokeRole(roleArgs)
            : await roleService.grantRole({ ...roleArgs, role });

        return { email, role, result, userId: user.id };
    } finally {
        await sequelize.close().catch(() => {});
    }
}

async function main(args = process.argv.slice(2)) {
    const { email, role, result, userId } = await run(args);
    console.log(`OK: ${email} Growth OS role => ${role} (user ${userId})`);
    return result;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = error.exitCode || 1;
    });
}

module.exports = {
    BOOTSTRAP_REASON,
    USAGE,
    VALID_ROLES,
    main,
    parseArguments,
    run,
};
