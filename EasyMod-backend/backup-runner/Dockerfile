FROM node:20-alpine

# Install PostgreSQL client for database backups
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy the standalone backup scripts. They intentionally use environment
# values directly so this image does not need the full application/config
# tree or production application secrets.
COPY scripts/backup-database.js /app/scripts/backup-database.js
COPY scripts/restore-database.js /app/scripts/restore-database.js
COPY scripts/restore-media.js /app/scripts/restore-media.js

# Create backups directory
RUN mkdir -p /backups
ENV BACKUP_DIR=/backups

# Set permissions
RUN chown -R node:node /app /backups
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('fs').accessSync('/app/scripts/backup-database.js')"

# Default command - backup
CMD ["node", "/app/scripts/backup-database.js", "create"]
