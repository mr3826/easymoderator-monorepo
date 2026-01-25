#!/bin/bash

###############################################################################
# Deployment Script for Commerce AI Server
# Run this script to deploy updates to EC2
###############################################################################

set -e  # Exit on error

APP_DIR="/home/ubuntu/commerce-ai/server-commerce-ai-dev"
BRANCH="${1:-main}"

echo "🚀 Deploying Commerce AI Server from branch: $BRANCH"

# Navigate to app directory
cd $APP_DIR

# Stash any local changes
echo "📦 Stashing local changes..."
git stash

# Fetch latest changes
echo "📥 Fetching latest changes..."
git fetch origin

# Checkout and pull the specified branch
echo "🔄 Checking out branch: $BRANCH"
git checkout $BRANCH
git pull origin $BRANCH

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Run database migrations
echo "🗄️  Running database migrations..."
npm run migrate

# Reload PM2 processes
echo "🔄 Reloading PM2 processes..."
pm2 reload ecosystem.config.js --update-env

# Show status
echo "📊 Application status:"
pm2 status

# Save PM2 process list
pm2 save

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Useful commands:"
echo "  pm2 logs          - View application logs"
echo "  pm2 monit         - Monitor processes"
echo "  pm2 restart all   - Restart all processes"
echo ""
