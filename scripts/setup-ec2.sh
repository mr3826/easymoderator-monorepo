#!/bin/bash

###############################################################################
# EC2 Setup Script for Commerce AI Server
# Run this once on a fresh Ubuntu EC2 instance
###############################################################################

set -e  # Exit on error

echo "🚀 Setting up Commerce AI Server on EC2..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 20.x LTS
echo "📦 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installations
echo "✅ Node version: $(node --version)"
echo "✅ NPM version: $(npm --version)"

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install PostgreSQL client (server should use RDS)
echo "📦 Installing PostgreSQL client..."
sudo apt-get install -y postgresql-client

# Install Redis client tools (server should use ElastiCache)
echo "📦 Installing Redis tools..."
sudo apt-get install -y redis-tools

# Install Git
echo "📦 Installing Git..."
sudo apt-get install -y git

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /home/ubuntu/commerce-ai
sudo chown ubuntu:ubuntu /home/ubuntu/commerce-ai

# Create logs directory
mkdir -p /home/ubuntu/commerce-ai/server-commerce-ai-dev/logs

# Install nginx (optional - for reverse proxy)
echo "📦 Installing Nginx..."
sudo apt-get install -y nginx

# Configure nginx as reverse proxy
echo "🔧 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/commerce-ai > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    # Request size limits
    client_max_body_size 10M;

    # Logging
    access_log /var/log/nginx/commerce-ai-access.log;
    error_log /var/log/nginx/commerce-ai-error.log;

    # Proxy to Node.js app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/commerce-ai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
sudo systemctl enable nginx

# Configure firewall
echo "🔒 Configuring firewall..."
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw --force enable

# Setup PM2 startup script
echo "🔧 Configuring PM2 startup..."
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Note: Run the command that PM2 outputs above with sudo

# Create environment file template
echo "📝 Creating environment file template..."
cat > /home/ubuntu/commerce-ai/server-commerce-ai-dev/.env.template <<EOF
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://username:password@your-rds-endpoint:5432/commerce_ai
REDIS_URL=redis://your-elasticache-endpoint:6379
JWT_ACCESS_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)
JWT_ACCESS_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=30d
SESSION_SECRET=$(openssl rand -base64 32)
EOF

echo ""
echo "✅ EC2 setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update RDS and ElastiCache endpoints in .env file"
echo "2. Clone your repository: git clone <your-repo-url> /home/ubuntu/commerce-ai/server-commerce-ai-dev"
echo "3. Copy .env.template to .env and update values"
echo "4. Run: cd /home/ubuntu/commerce-ai/server-commerce-ai-dev && npm install"
echo "5. Run database migrations: npm run migrate"
echo "6. Start with PM2: pm2 start ecosystem.config.js"
echo "7. Save PM2 process list: pm2 save"
echo "8. Configure domain and SSL certificate (Let's Encrypt)"
echo ""
