#!/bin/sh
# Backend entrypoint script for Docker
# Handles: npm install, database migrations, seed data, and dev server startup

set -e

echo "=========================================="
echo "EasyMod Backend - Docker Initialization"
echo "=========================================="

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
counter=0
max_attempts=30
until PGPASSWORD=$POSTGRES_PASSWORD psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1" 2>/dev/null || [ $counter -eq $max_attempts ]; do
  echo "Attempt $counter/$max_attempts: Waiting for PostgreSQL..."
  counter=$((counter + 1))
  sleep 2
done

if [ $counter -eq $max_attempts ]; then
  echo "ERROR: PostgreSQL failed to start after $max_attempts attempts"
  exit 1
fi

echo "✓ PostgreSQL is ready"

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
  echo "Installing dependencies..."
  npm install
  echo "✓ Dependencies installed"
fi

# Run database sync/migrations
echo "Syncing database schema..."
npm run db:sync || echo "Note: db:sync may not be available, continuing..."

# Seed admin user if database is empty
echo "Seeding admin user..."
npm run seed:admin

echo ""
echo "=========================================="
echo "✓ Initialization Complete!"
echo "=========================================="
echo ""
echo "Admin credentials:"
echo "  Email: $SEED_ADMIN_EMAIL"
echo "  Password: $SEED_ADMIN_PASSWORD"
echo ""
echo "Starting development server..."
echo "=========================================="
echo ""

# Start the dev server
npm run dev
