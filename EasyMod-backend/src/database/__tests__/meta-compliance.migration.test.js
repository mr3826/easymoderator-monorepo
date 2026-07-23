'use strict';

const migration = require('../migrations/20260723_001_meta_compliance_identity_and_deletion');

describe('Meta compliance identity and deletion migration', () => {
    test('creates the identity bridge, durable request table, and required indexes', async () => {
        const sequelize = { query: jest.fn().mockResolvedValue(undefined) };

        await migration.up(sequelize);

        const sql = sequelize.query.mock.calls.map(([statement]) => statement).join('\n');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS meta_user_identities');
        expect(sql).toContain('uq_meta_user_identities_app_channel');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS meta_data_deletion_requests');
        expect(sql).toContain('request_fingerprint VARCHAR(64) NOT NULL UNIQUE');
        expect(sql).toContain("AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')");
        expect(sql).not.toContain('signed_request');
        expect(sql).not.toContain('confirmation_code VARCHAR');
    });

    test('drops only the Phase 1 compliance schema in dependency-safe order', async () => {
        const sequelize = { query: jest.fn().mockResolvedValue(undefined) };

        await migration.down(sequelize);

        expect(sequelize.query.mock.calls.map(([statement]) => statement)).toEqual([
            'DROP TABLE IF EXISTS meta_data_deletion_requests;',
            'DROP TYPE IF EXISTS enum_meta_data_deletion_requests_status;',
            'DROP TABLE IF EXISTS meta_user_identities;',
        ]);
    });
});
