FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --silent

COPY . .

ARG VITE_APP_DOMAIN=growth.easymod.tech
ARG VITE_APP_API_BASE=https://api.easymod.tech/api/internal/growth-os
ARG VITE_APP_FRONTEND_VERSION=1.0.0

ENV VITE_APP_DOMAIN=$VITE_APP_DOMAIN \
    VITE_APP_API_BASE=$VITE_APP_API_BASE \
    VITE_APP_FRONTEND_VERSION=$VITE_APP_FRONTEND_VERSION \
    NODE_ENV=production \
    CI=true

RUN npm run build

FROM nginx:1.25-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
