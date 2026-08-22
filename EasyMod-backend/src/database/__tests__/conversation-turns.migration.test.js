'use strict';

const migration = require('../migrations/20260823_001_conversation_turns');

const run = async (method) => {
    const statements = [];
    await migration[method]({
        getDialect: () => 'postgres',
        query: async (sql) => { statements.push(sql); return [[]]; },
    });
    return statements.join('\n');
};

describe('20260823_001_conversation_turns', () => {
    test('exports the custom-runner migration contract', () => {
        expect(migration.name).toBe('20260823_001_conversation_turns');
        expect(typeof migration.up).toBe('function');
        expect(typeof migration.down).toBe('function');
    });

    test('creates the recovery telemetry columns and tenant-scoped indexes', async () => {
        const sql = await run('up');
        for (const column of [
            'turn_id', 'trace_id', 'shop_id', 'conversation_id', 'intent_id', 'state', 'retry_state',
            'recovery_kind', 'state_transitions', 'turn_started_at', 'first_holding_at', 'hard_timeout_at',
            'handoff_created_at', 'handoff_ack_at', 'retry_count', 'idempotency_key', 'mutation_status',
            'outbound_status', 'provider_reference', 'recovery_reason', 'final_state',
        ]) {
            expect(sql).toContain(column);
        }
        expect(sql).toMatch(/idx_conversation_turns_conversation_turn[\s\S]*conversation_id, turn_id/);
        expect(sql).toMatch(/idx_conversation_turns_shop_created[\s\S]*shop_id, created_at/);
    });

    test('down removes only the conversation turns table', async () => {
        expect(await run('down')).toContain('DROP TABLE IF EXISTS conversation_turns CASCADE');
    });
});
