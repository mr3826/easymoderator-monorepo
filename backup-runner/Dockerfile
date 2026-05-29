FROM node:20-alpine

# Install PostgreSQL client for database backups
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy backup scripts
COPY scripts/backup-database.js /app/
COPY scripts/restore-database.js /app/

# Create backups directory
RUN mkdir -p /backups

# Set permissions
RUN chown -R node:node /app /backups
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('fs').existsSync('/app/ready') ? process.exit(0) : process.exit(1)"

# Default command - backup
CMD ["node", "/app/backup-database.js", "create"]
