# Stage 1: Build the React app
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency files first for better caching
COPY package*.json ./
# Copy lock file for deterministic builds
COPY package-lock.json ./

# Install dependencies with cache mounting
# Use ci instead of install for deterministic builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --silent

# Copy source code after dependencies are installed
# This layer only rebuilds when source code changes
COPY . .

# Vite build-time env vars injected as build args
ARG VITE_API_BASE_URL
ARG VITE_META_APP_ID
ARG VITE_ENV=production
ARG VITE_SENTRY_DSN

# Set environment variables
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_META_APP_ID=$VITE_META_APP_ID \
    VITE_ENV=$VITE_ENV \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    NODE_ENV=production \
    CI=true

# Build the application
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.25-alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run requires the container to listen on $PORT (default 8080)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
