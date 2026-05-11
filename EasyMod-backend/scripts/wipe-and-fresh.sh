#!/usr/bin/env bash
# wipe-and-fresh.sh
#
# Wipes all data from the database (TRUNCATES all tables, keeps schema) and flushes Redis.
# Intended for fresh Digital Ocean deployments before running migrations.
#
# ⚠️  DESTRUCTIVE: This deletes ALL data. Run only on the new server, never on production
#     with existing users.
#
# Usage:
#   DATABASE_URL=postgresql://... REDIS_URL=redis://... ./scripts/wipe-and-fresh.sh
#
# Inside docker (from /opt/easymod on the droplet):
#   docker compose -f docker-compose.prod.yml exec backend bash /app/scripts/wipe-and-fresh.sh

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is not set."
    exit 1
fi

echo "=== Easy Moderator — Fresh Deploy Wipe ==="
echo ""
echo "⚠️  This will DELETE ALL DATA from the database and Redis."
echo "    Target DB: $(echo $DATABASE_URL | sed 's|:.*@|:****@|')"
echo "    Target Redis: $REDIS_URL"
echo ""
read -r -p "Type 'YES' to confirm: " confirm
if [ "$confirm" != "YES" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "1. Truncating all database tables..."

# Get all tables in dependency order and truncate them
# Using CASCADE to handle foreign keys
psql "$DATABASE_URL" <<'SQL'
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Disable triggers temporarily for speed
    EXECUTE 'SET session_replication_role = replica';

    FOR r IN (
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('schema_migrations', 'migrations')
        ORDER BY tablename
    ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
        RAISE NOTICE 'Truncated %', r.tablename;
    END LOOP;

    -- Re-enable triggers
    EXECUTE 'SET session_replication_role = DEFAULT';
END $$;
SQL

echo "   ✓ All tables truncated"

echo ""
echo "2. Flushing Redis..."

# Parse REDIS_URL to get host/port
REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+).*|\1|')
REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')
REDIS_PORT="${REDIS_PORT:-6379}"

redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" FLUSHALL
echo "   ✓ Redis flushed"

echo ""
echo "3. Running database migrations..."
npm run migrate
echo "   ✓ Migrations complete"

echo ""
echo "4. (Optional) Running initial seed..."
echo "   Skipping — run 'npm run seed:admin' manually if you need an admin user."

echo ""
echo "=== Wipe complete. Fresh deployment ready. ==="
echo ""
echo "Next steps:"
echo "  docker compose -f docker-compose.prod.yml exec backend npm run seed:admin"
echo "  # Then configure your first shop via the frontend."
