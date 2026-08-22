'use strict';

/**
 * Grant or revoke an EasyModerator Growth OS role.
 *
 * Usage:
 *   node src/scripts/grant-growth-role.js <email> <ROLE|NONE> --actor <email-or-id>
 *
 * The operator must be explicit. The role service owns the transaction, audit
 * row, and cache invalidation.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const roleService = require('../modules/growth-os/growth-os.roles.service');
const { GROWTH_OS_ROLES } = require('../modules/growth-os/growth-os.permissions');
const { validate: isUuid } = require('uuid');

const VALID_ROLES = [...Object.values(GROWTH_OS_ROLES), 'NONE'];
const ACTOR_FLAG = '--actor';
const USAGE = 'Usage: node src/scripts/grant-growth-role.js <email> <ROLE|NONE> --actor <email-or-id>';
const BOOTSTRAP_REASON = 'Growth OS role bootstrap via CLI';

function cliError(message, exitCode = 1) {
    const error = new Error(message);
    error.exitCode = exitCode;
    return error;
}

function parseArguments(args) {
    const [email, role, actorFlag, actor] = args;
    if (!email || !role || !VALID_ROLES.includes(role) || actorFlag !== ACTOR_FLAG || !actor || args.length !== 4) {
        throw cliError(USAGE);
    }
    return { email, role, actor };
}

async function findUserByEmailOrId(identifier) {
    if (isUuid(String(identifier))) return User.findByPk(identifier);
    return User.findOne({ where: { email: identifier } });
}

async function run(args = process.argv.slice(2)) {
    const { email, role, actor } = parseArguments(args);

    await sequelize.authenticate();
    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            throw cliError(`No user found with email ${email}`, 2);
        }

        const actorUser = await findUserByEmailOrId(actor);
        if (!actorUser) {
            throw cliError(`No actor found for ${actor}`, 2);
        }

        const roleArgs = {
            actorUserId: actorUser.id,
            targetUserId: user.id,
            reason: BOOTSTRAP_REASON,
        };
        const result = role === 'NONE'
            ? await roleService.revokeRole(roleArgs)
            : await roleService.grantRole({ ...roleArgs, role });

        return { email, role, actor: actorUser.id, result, userId: user.id };
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
