-- Initialize database for EasyMod
-- This script runs when PostgreSQL container starts

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create additional schemas if needed
-- CREATE SCHEMA IF NOT EXISTS n8n;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE easymod_dev TO easymod_user;
