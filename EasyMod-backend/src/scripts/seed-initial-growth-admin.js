'use strict';

/**
 * Create the one-time, shop-less identity used to establish the first
 * canonical Growth OS SUPER_ADMIN.
 *
 * This script deliberately does not grant a Growth role. The protected role
 * workflow remains the only code path that creates the first SUPER_ADMIN row.
 * The password arrives only through INITIAL_GROWTH_ADMIN_PASSWORD, is hashed
 * by the production password utility, and is never logged or audited.
 */

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../utils/database/database-setup');
const { User, GrowthOsUserRole } = require('../modules/entities');
const { hashPassword } = require('../utils/password.util');
const { getTemporaryPasswordExpiry } = require('../modules/auth/temporary-password');
const AuditService = require('../modules/audit/audit.service');
const { SUPER_ADMIN_ROLE_VALUES } = require('../modules/growth-os/growth-os.roles.service');

const DEFAULT_EMAIL = 'growth-admin@easymod.tech';
const DEFAULT_DISPLAY_NAME = 'Growth Administrator';
const BOOTSTRAP_LOCK_KEY = 'easymod:growth-os:first-super-admin';
const BOOTSTRAP_AUDIT_ACTION = 'growth_os:initial_admin_seeded';
const BOOTSTRAP_AUDIT_RESOURCE = 'GROWTH_OS_BOOTSTRAP';

function cliError(message, exitCode = 1) {
    const error = new Error(message);
    error.exitCode = exitCode;
    return error;
}

function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw cliError('INITIAL_GROWTH_ADMIN_EMAIL must be a valid email address.', 2);
    }
    return email;
}

function validateTemporaryPassword(value) {
    const password = typeof value === 'string' ? value : '';
    if (!password) throw cliError('INITIAL_GROWTH_ADMIN_PASSWORD is required.', 2);
    if (/[\r\n\0]/.test(password)) {
        throw cliError('INITIAL_GROWTH_ADMIN_PASSWORD must be a single-line value.', 2);
    }
    if (password.length < 8
        || !/[A-Z]/.test(password)
        || !/[0-9]/.test(password)
        || !/[^A-Za-z0-9]/.test(password)) {
        throw cliError('INITIAL_GROWTH_ADMIN_PASSWORD does not meet the password policy.', 2);
    }
    return password;
}

function readConfiguration(environment = process.env) {
    return {
        email: normalizeEmail(environment.INITIAL_GROWTH_ADMIN_EMAIL || DEFAULT_EMAIL),
        displayName: String(environment.INITIAL_GROWTH_ADMIN_DISPLAY_NAME || DEFAULT_DISPLAY_NAME)
            .trim()
            .slice(0, 255) || DEFAULT_DISPLAY_NAME,
        password: validateTemporaryPassword(environment.INITIAL_GROWTH_ADMIN_PASSWORD),
        githubActor: /^[A-Za-z0-9_.-]{1,100}$/.test(String(environment.GITHUB_ACTOR || '').trim())
            ? String(environment.GITHUB_ACTOR).trim()
            : null,
    };
}

function assertExecutionEnvironment(environment = process.env) {
    const nodeEnvironment = String(environment.NODE_ENV || '').trim();
    if (nodeEnvironment !== 'production') {
        throw cliError('Initial Growth OS admin seeding is allowed only in production.', 2);
    }
}

async function acquireBootstrapLock(transaction) {
    if (sequelize.getDialect?.() !== 'postgres') return;
    await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtext(:lockKey))',
        { replacements: { lockKey: BOOTSTRAP_LOCK_KEY }, transaction },
    );
}

async function findPendingBootstrapUser(transaction) {
    const dialect = sequelize.getDialect?.();
    if (dialect === 'postgres') {
        const rows = await sequelize.query(
            `SELECT id, email
               FROM users
              WHERE settings @> CAST(:marker AS jsonb)
              LIMIT 1
              FOR UPDATE`,
            {
                replacements: { marker: JSON.stringify({ internal_growth_bootstrap: true }) },
                type: QueryTypes.SELECT,
                transaction,
            },
        );
        return rows[0] || null;
    }

    const rows = await sequelize.query(
        `SELECT id, email
           FROM users
          WHERE json_extract(settings, '$.internal_growth_bootstrap') = 1
          LIMIT 1`,
        { type: QueryTypes.SELECT, transaction },
    );
    return rows[0] || null;
}

async function run(environment = process.env) {
    assertExecutionEnvironment(environment);
    const { email, displayName, password, githubActor } = readConfiguration(environment);

    await sequelize.authenticate();
    try {
        return await sequelize.transaction(async (transaction) => {
            await acquireBootstrapLock(transaction);

            const activeSuperAdmin = await GrowthOsUserRole.findOne({
                attributes: ['id'],
                where: {
                    role: { [Op.in]: SUPER_ADMIN_ROLE_VALUES },
                    is_active: true,
                    revoked_at: { [Op.is]: null },
                },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (activeSuperAdmin) {
                throw cliError('Initial Growth OS admin already exists; refusing to seed another account.', 3);
            }

            const pendingBootstrapUser = await findPendingBootstrapUser(transaction);
            if (pendingBootstrapUser) {
                throw cliError('An initial Growth OS admin seed is already pending; refusing to create another account.', 3);
            }

            const existingUser = await User.findOne({
                attributes: ['id'],
                where: { email },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (existingUser) {
                throw cliError('The requested initial Growth OS admin email already exists; refusing to overwrite it.', 3);
            }

            const user = await User.create({
                email,
                password: await hashPassword(password),
                full_name: displayName,
                role: 'internal',
                is_active: true,
                is_verified: true,
                platform_role: null,
                token_version: 1,
                refresh_token: null,
                must_change_password: true,
                temporary_password_expires_at: getTemporaryPasswordExpiry(),
                settings: { internal_growth_bootstrap: true },
            }, { transaction });

            await AuditService.logOperation({
                userId: null,
                shopId: null,
                action: BOOTSTRAP_AUDIT_ACTION,
                resourceType: BOOTSTRAP_AUDIT_RESOURCE,
                resourceId: user.id,
                oldValues: null,
                newValues: {
                    email: user.email,
                    full_name: user.full_name,
                    status: 'seeded',
                    password_change_required: true,
                    growth_role: null,
                },
                metadata: {
                    source: 'protected_initial_growth_admin_workflow',
                    github_actor: githubActor,
                    result: 'success',
                },
            }, { transaction, required: true });

            return {
                userId: user.id,
                email: user.email,
                displayName: user.full_name,
                passwordChangeRequired: true,
            };
        });
    } finally {
        await sequelize.close().catch(() => {});
    }
}

async function main(environment = process.env) {
    const result = await run(environment);
    console.log(`OK: initial Growth OS admin seeded for ${result.email} (user ${result.userId})`);
    return result;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = error.exitCode || 1;
    });
}

module.exports = {
    BOOTSTRAP_AUDIT_ACTION,
    BOOTSTRAP_AUDIT_RESOURCE,
    BOOTSTRAP_LOCK_KEY,
    DEFAULT_DISPLAY_NAME,
    DEFAULT_EMAIL,
    assertExecutionEnvironment,
    findPendingBootstrapUser,
    main,
    normalizeEmail,
    readConfiguration,
    run,
    validateTemporaryPassword,
};
