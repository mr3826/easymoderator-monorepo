FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production

# Build-time identifiers exposed via GET /api/version so we can verify
# "is this commit actually deployed?" with one curl.
ARG GIT_SHA=
ARG BUILD_TIME=
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Run as non-root (P1-7). /app/uploads is mounted as a persistent Docker volume
# in production; creating it here lets the volume inherit node-writable perms.
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 3000

# P1-7: HEALTHCHECK
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/ready', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
