'use strict';

/**
 * Grant or revoke an EasyModerator Growth OS role.
 *
 * Usage:
 *   GROWTH_BOOTSTRAP_ACTOR_EMAIL=<configured-operator-email> \
 *     node src/scripts/grant-growth-role.js <email> <SUPER_ADMIN>
 *
 * The operator must be explicit. The role service owns the transaction, audit
 * row, and cache invalidation.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const roleService = require('../modules/growth-os/growth-os.roles.service');
const { GROWTH_OS_ROLES } = require('../modules/growth-os/growth-os.permissions');

const VALID_ROLES = [GROWTH_OS_ROLES.SUPER_ADMIN];
const USAGE = 'Usage: GROWTH_BOOTSTRAP_ACTOR_EMAIL=<configured-operator-email> node src/scripts/grant-growth-role.js <email> <SUPER_ADMIN>';
const BOOTSTRAP_REASON = 'Growth OS role bootstrap via protected operator workflow';

function cliError(message, exitCode = 1) {
    const error = new Error(message);
    error.exitCode = exitCode;
    return error;
}

function parseArguments(args) {
    const [email, role] = args;
    if (!email || !role || !VALID_ROLES.includes(role) || args.length !== 2) {
        throw cliError(USAGE);
    }
    return { email, role };
}

async function run(args = process.argv.slice(2)) {
    const { email, role } = parseArguments(args);
    const configuredActorEmail = String(process.env.GROWTH_BOOTSTRAP_ACTOR_EMAIL || '').trim();
    if (!configuredActorEmail) throw cliError(USAGE);

    await sequelize.authenticate();
    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            throw cliError(`No user found with email ${email}`, 2);
        }

        const actorUser = await User.findOne({ where: { email: configuredActorEmail } });
        if (!actorUser) {
            throw cliError(`No configured bootstrap actor found for ${configuredActorEmail}`, 2);
        }

        const roleArgs = {
            actorUserId: actorUser.id,
            targetUserId: user.id,
            reason: process.env.GITHUB_ACTOR && /^[A-Za-z0-9_.-]{1,100}$/.test(process.env.GITHUB_ACTOR)
                ? `${BOOTSTRAP_REASON} (GitHub actor: ${process.env.GITHUB_ACTOR})`
                : BOOTSTRAP_REASON,
        };
        const result = await roleService.bootstrapRole({ ...roleArgs, role });

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
