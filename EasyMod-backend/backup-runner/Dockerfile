FROM node:20-alpine3.19

# Install a PostgreSQL client matching production's server major version
# (PostgreSQL 15). An unpinned `postgresql-client` drifts with whatever
# Alpine's rolling repo currently carries — a newer pg_restore issues SET
# statements for GUCs the PG15 server doesn't recognize (e.g.
# transaction_timeout, added in PG17), failing every restore even though the
# backup itself is fine.
RUN apk add --no-cache postgresql15-client

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
