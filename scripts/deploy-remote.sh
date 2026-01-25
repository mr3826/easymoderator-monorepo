#!/bin/bash

###############################################################################
# Local to EC2 Deployment Script
# Run this from your local machine to deploy to EC2
###############################################################################

set -e

# Configuration
EC2_HOST="${EC2_HOST:-your-ec2-ip-or-domain}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_KEY="${EC2_KEY:-~/.ssh/your-key.pem}"
BRANCH="${1:-main}"

echo "🚀 Deploying to EC2: $EC2_HOST"

# SSH and run deployment
ssh -i "$EC2_KEY" "$EC2_USER@$EC2_HOST" "bash -s" < ./scripts/deploy.sh "$BRANCH"

echo "✅ Remote deployment complete!"
