/**
 * Version endpoint — unauthenticated, used to verify "is the fix actually live?"
 * with a single curl, rather than digging through GH Actions logs.
 *
 *   GET /api/version
 *   → { gitSha, gitShortSha, buildTime, startedAt, migrations: { count, latest } }
 *
 * GIT_SHA is set at image-build time via a Dockerfile ARG → ENV (see Dockerfile).
 * Migration count comes from the `migrations` table, which is the authoritative
 * source of what DDL has actually been applied to the live database.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { sequelize } = require('../utils/database/database-setup');

const STARTED_AT = new Date().toISOString();

router.get('/', async (_req, res) => {
    const gitSha = process.env.GIT_SHA || null;
    const payload = {
        gitSha,
        gitShortSha: gitSha ? gitSha.slice(0, 8) : null,
        buildTime: process.env.BUILD_TIME || null,
        startedAt: STARTED_AT,
        migrations: { count: null, latest: null },
    };

    try {
        const [rows] = await sequelize.query(
            'SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 1'
        );
        const [countRows] = await sequelize.query('SELECT COUNT(*)::int AS n FROM migrations');
        payload.migrations.count = countRows[0]?.n ?? null;
        payload.migrations.latest = rows[0]?.name ?? null;
    } catch (_err) {
        // Migrations table missing or DB down. Surface as nulls — never leak
        // error.message from an unauthenticated endpoint (would expose
        // hostname / credentials in connection strings).
    }

    res.status(200).json(payload);
});

module.exports = router;
