FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --silent

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_ENV=production

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_ENV=$VITE_ENV \
    NODE_ENV=production \
    CI=true

RUN npm run build

FROM nginx:1.25-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
