FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --silent

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_ENV=production
ARG VITE_BUILD_SHA=unknown

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_ENV=$VITE_ENV \
    VITE_BUILD_SHA=$VITE_BUILD_SHA \
    NODE_ENV=production \
    CI=true

RUN npm run build && printf '{"commit":"%s"}\n' "$VITE_BUILD_SHA" > dist/build-info.json

FROM nginx:1.25-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
