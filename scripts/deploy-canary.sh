#!/bin/bash
# Canary deploy script: deploys new app version as canary, routes 5% traffic

set -e

CANARY_VERSION=${1:-canary}
CANARY_CONTAINER=app-${CANARY_VERSION}

# Build and start canary container

docker build -t $CANARY_CONTAINER .
docker run -d --name $CANARY_CONTAINER -p 3001:3000 $CANARY_CONTAINER

# Update NGINX config to include canary backend
cp nginx.conf /etc/nginx/nginx.conf
nginx -s reload

echo "Canary deploy started: $CANARY_CONTAINER running, NGINX routing 5% traffic."
