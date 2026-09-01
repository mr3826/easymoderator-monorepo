/**
 * Schema-drift audit: compares every Sequelize entity against the live database.
 *
 * Born 2026-06-11 after the fourth prod incident of the same family
 * (order_sessions.metadata, orders.idempotency_key, delivery credentials JSONB,
 * order_sequences.counter): tables created by the initial squash migration drift
 * from what the entities expect, unit tests mock the DB so nothing catches it,
 * and the first real INSERT in prod 500s.
 *
 * Checks, per model:
 *   1. MISSING_TABLE   — model's table absent in the DB
 *   2. MISSING_COLUMN  — model attribute with no matching column (SELECT/INSERT dies)
 *   3. EXTRA_REQUIRED  — DB column NOT NULL with no default that the model never
 *                        writes (every INSERT dies — the policy_decisions class)
 *   4. TYPE_MISMATCH   — incompatible type family, e.g. entity TEXT vs DB jsonb
 *                        (the delivery credentials class)
 *   5. ENUM_VALUE      — model ENUM value missing from the pg enum type
 *                        (the redx class)
 *
 * Run inside the backend container:  node scripts/schema-drift-audit.js
 * Read-only — issues only information_schema/pg_catalog SELECTs.
 * Exits 1 if any finding, 0 if clean (usable as a deploy gate).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_SRC = path.join(__dirname, '..', 'src');

// Type families considered write-compatible. Key: sequelize DataTypes key.
const TYPE_FAMILY = {
    UUID: ['uuid'],
    UUIDV4: ['uuid'],
    STRING: ['character varying', 'text', 'citext'],
    TEXT: ['text', 'character varying', 'citext'],
    CHAR: ['character', 'character varying'],
    BOOLEAN: ['boolean'],
    INTEGER: ['integer', 'bigint', 'smallint'],
    BIGINT: ['bigint', 'integer'],
    SMALLINT: ['smallint', 'integer'],
    FLOAT: ['double precision', 'real', 'numeric'],
    DOUBLE: ['double precision', 'real', 'numeric'],
    'DOUBLE PRECISION': ['double precision', 'real', 'numeric'],
    REAL: ['real', 'double precision', 'numeric'],
    DECIMAL: ['numeric', 'double precision'],
    NUMBER: ['numeric', 'integer', 'bigint', 'double precision'],
    DATE: ['timestamp with time zone', 'timestamp without time zone'],
    DATEONLY: ['date'],
    TIME: ['time without time zone', 'time with time zone'],
    JSON: ['json', 'jsonb'],
    JSONB: ['jsonb', 'json'],
    BLOB: ['bytea'],
    ENUM: ['USER-DEFINED', 'character varying', 'text'],
    ARRAY: ['ARRAY'],
    RANGE: ['USER-DEFINED'],
    GEOMETRY: ['USER-DEFINED'],
    VIRTUAL: null, // never persisted
};

const TARGETED_CONTRACTS = [
    {
        key: 'orders.metadata',
        table: 'orders',
        column: 'metadata',
        type: 'jsonb',
        nullable: 'YES',
        defaultPattern: /'\{\}'::jsonb/i,
    },
    {
        key: 'subscriptions.threshold_debt',
        table: 'subscriptions',
        column: 'threshold_debt',
        type: 'integer',
        nullable: 'NO',
        defaultPattern: /\b0\b/,
    },
    {
        key: 'subscriptions.usage_reset_at',
        table: 'subscriptions',
        column: 'usage_reset_at',
        type: 'timestamp with time zone',
        nullable: 'YES',
    },
];

function walkEntities(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (name === 'node_modules' || name === '__tests__') continue;
            walkEntities(full, out);
        } else if (name.endsWith('.entity.js')) {
            out.push(full);
        }
    }
    return out;
}

async function main() {
    const { sequelize } = require(path.join(APP_SRC, 'utils', 'database', 'database-setup'));

    const entityFiles = walkEntities(path.join(APP_SRC, 'modules'));
    const loadErrors = [];
    for (const f of entityFiles) {
        try { require(f); } catch (e) { loadErrors.push(`${path.relative(APP_SRC, f)}: ${e.message}`); }
    }

    const [columnsRows] = await sequelize.query(`
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
    `);
    const dbTables = {};
    for (const r of columnsRows) {
        (dbTables[r.table_name] = dbTables[r.table_name] || {})[r.column_name] = r;
    }

    const [enumRows] = await sequelize.query(`
        SELECT t.typname, e.enumlabel
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    `);
    const dbEnums = {};
    for (const r of enumRows) (dbEnums[r.typname] = dbEnums[r.typname] || new Set()).add(r.enumlabel);

    const findings = [];
    const warnings = [];
    for (const error of loadErrors) {
        findings.push({ kind: 'ENTITY_LOAD_ERROR', table: '(entity)', detail: error });
    }
    const models = Object.values(sequelize.models);

    for (const contract of TARGETED_CONTRACTS) {
        const col = dbTables[contract.table] && dbTables[contract.table][contract.column];
        if (!col) {
            findings.push({ kind: 'P0_P1_RUNTIME_SCHEMA_DRIFT', table: contract.table, detail: `${contract.column} is missing` });
            continue;
        }
        if (col.data_type !== contract.type || col.is_nullable !== contract.nullable
            || (contract.defaultPattern && !contract.defaultPattern.test(String(col.column_default || '')))) {
            findings.push({
                kind: 'P0_P1_RUNTIME_SCHEMA_DRIFT',
                table: contract.table,
                detail: `${contract.column}: expected ${contract.type}, nullable=${contract.nullable}, default=${contract.defaultPattern ? contract.defaultPattern : 'none'}; got ${col.data_type}, nullable=${col.is_nullable}, default=${col.column_default}`,
            });
        }
    }

    for (const model of models) {
        const tn = typeof model.getTableName() === 'string'
            ? model.getTableName() : model.getTableName().tableName;
        const dbCols = dbTables[tn];
        if (!dbCols) {
            findings.push({ kind: 'MISSING_TABLE', table: tn, detail: `model ${model.name}` });
            continue;
        }

        const modelFields = new Set();
        for (const [attrName, attr] of Object.entries(model.rawAttributes)) {
            const typeKey = attr.type && attr.type.key;
            if (typeKey === 'VIRTUAL') continue;
            const field = attr.field || attrName;
            modelFields.add(field);

            const col = dbCols[field];
            if (!col) {
                findings.push({ kind: 'MISSING_COLUMN', table: tn, detail: `${field} (${typeKey})` });
                continue;
            }

            const family = TYPE_FAMILY[typeKey];
            if (family && !family.includes(col.data_type)) {
                findings.push({
                    kind: 'TYPE_MISMATCH', table: tn,
                    detail: `${field}: entity ${typeKey} vs db ${col.data_type}`,
                });
            }

            if (typeKey === 'ENUM' && col.data_type === 'USER-DEFINED') {
                const labels = dbEnums[col.udt_name] || new Set();
                for (const v of attr.values || []) {
                    if (!labels.has(v)) {
                        findings.push({
                            kind: 'ENUM_VALUE', table: tn,
                            detail: `${field}: value '${v}' missing from pg enum ${col.udt_name}`,
                        });
                    }
                }
            }
        }

        for (const [colName, col] of Object.entries(dbCols)) {
            if (modelFields.has(colName)) continue;
            if (col.is_nullable === 'YES' || col.column_default !== null) continue;
            findings.push({
                kind: 'EXTRA_REQUIRED', table: tn,
                detail: `${colName} ${col.data_type} NOT NULL with no default — model never writes it, INSERTs will fail`,
            });
        }

        // Warning-only: model allows null but DB demands a value. Inserts fail
        // only when code actually omits the field, so this doesn't gate.
        for (const [attrName, attr] of Object.entries(model.rawAttributes)) {
            if ((attr.type && attr.type.key) === 'VIRTUAL' || attr.primaryKey) continue;
            const field = attr.field || attrName;
            const col = dbCols[field];
            if (!col || col.is_nullable === 'YES' || col.column_default !== null) continue;
            if (attr.allowNull === false || attr.defaultValue !== undefined) continue;
            warnings.push(`${tn}.${field}: entity allows null but DB is NOT NULL with no default`);
        }
    }

    console.log(`Audited ${models.length} models from ${entityFiles.length} entity files against ${Object.keys(dbTables).length} tables.`);
    if (loadErrors.length) {
        console.log('\nEntity files that failed to load (not audited):');
        for (const e of loadErrors) console.log('  !', e);
    }
    if (warnings.length) {
        console.log('\nWarnings (non-gating):');
        for (const w of warnings) console.log('  ~', w);
    }
    if (!findings.length) {
        console.log('\nNo drift found.');
        await sequelize.close();
        process.exit(0);
    }
    console.log(`\n${findings.length} finding(s):`);
    for (const f of findings.sort((a, b) => a.table.localeCompare(b.table))) {
        console.log(`  [${f.kind}] ${f.table}: ${f.detail}`);
    }
    await sequelize.close();
    process.exit(1);
}

if (require.main === module) {
    main().catch((e) => { console.error('Audit crashed:', e); process.exit(2); });
}

module.exports = { TARGETED_CONTRACTS, TYPE_FAMILY, walkEntities };
