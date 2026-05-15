#!/usr/bin/env bash
# Quick deployment helper for EasyMod Backend
# Usage: bash scripts/deploy-helper.sh

set -euo pipefail

EC2_IP="3.111.186.154"
EC2_USER="ubuntu"

echo "=========================================="
echo "EasyMod Backend Deployment Helper"
echo "=========================================="
echo ""
echo "EC2 Instance: ${EC2_IP}"
echo ""

# Check if SSH key is provided
if [ -z "${SSH_KEY_PATH:-}" ]; then
  read -p "Enter path to your .pem key file: " SSH_KEY_PATH
fi

if [ ! -f "$SSH_KEY_PATH" ]; then
  echo "Error: SSH key not found at $SSH_KEY_PATH"
  exit 1
fi

# Set correct permissions
chmod 400 "$SSH_KEY_PATH"

echo ""
echo "Select an action:"
echo "1) Bootstrap EC2 (first-time setup)"
echo "2) Setup Nginx + SSL"
echo "3) Test SSH connection"
echo "4) View deployment logs"
echo "5) Restart backend service"
echo ""
read -p "Enter choice [1-5]: " choice

case $choice in
  1)
    echo ""
    echo "Bootstrapping EC2 instance..."
    echo "This will install Docker, AWS CLI, Nginx, and Certbot"
    echo ""
    
    # Upload the setup script
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      scripts/ec2-setup.sh "${EC2_USER}@${EC2_IP}:/tmp/"
    
    # Run the setup script
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "${EC2_USER}@${EC2_IP}" "sudo bash /tmp/ec2-setup.sh"
    
    echo ""
    echo "✅ Bootstrap complete!"
    echo "Please re-login to apply docker group membership:"
    echo "ssh -i $SSH_KEY_PATH ${EC2_USER}@${EC2_IP}"
    ;;
    
  2)
    echo ""
    read -p "Enter your API domain (e.g., api.yourdomain.com): " API_DOMAIN
    
    if [ -z "$API_DOMAIN" ]; then
      echo "Error: Domain is required"
      exit 1
    fi
    
    # Create temporary nginx config with the domain
    TMP_NGINX="/tmp/nginx-easymod.conf"
    sed "s/api.example.com/${API_DOMAIN}/g" nginx.minimal.conf > "$TMP_NGINX"
    
    # Upload nginx config
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "$TMP_NGINX" "${EC2_USER}@${EC2_IP}:/tmp/easymod-backend"
    
    # Setup nginx and SSL
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "${EC2_USER}@${EC2_IP}" << EOF
sudo mv /tmp/easymod-backend /etc/nginx/sites-available/easymod-backend
sudo ln -sf /etc/nginx/sites-available/easymod-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
echo ""
echo "Nginx configured. Now running Certbot for SSL..."
sudo certbot --nginx -d ${API_DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email || true
EOF
    
    rm -f "$TMP_NGINX"
    echo ""
    echo "✅ Nginx and SSL setup complete!"
    ;;
    
  3)
    echo ""
    echo "Testing SSH connection..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "${EC2_USER}@${EC2_IP}" "echo '✅ SSH connection successful!' && docker --version && aws --version"
    ;;
    
  4)
    echo ""
    echo "Fetching deployment logs..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "${EC2_USER}@${EC2_IP}" "cd /app/easymod-backend && docker compose -f docker-compose.prod.yml logs --tail=100 backend"
    ;;
    
  5)
    echo ""
    echo "Restarting backend service..."
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
      "${EC2_USER}@${EC2_IP}" "cd /app/easymod-backend && docker compose -f docker-compose.prod.yml restart backend"
    echo "✅ Backend restarted!"
    ;;
    
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
