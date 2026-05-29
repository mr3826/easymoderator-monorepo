#!/usr/bin/env bash
# do-server-setup.sh
# Run once on a fresh Ubuntu 24.04 Digital Ocean droplet.
# Sets up Docker, creates deploy directory, and pulls the first deploy.
#
# Usage:
#   scp scripts/do-server-setup.sh root@<DO_IP>:/root/
#   ssh root@<DO_IP> "bash /root/do-server-setup.sh"

set -euo pipefail

echo "=== EasyMod DO Server Setup ==="
echo ""

# ── 1. System update ──────────────────────────────────────────────────────────
echo "1. Updating system packages..."
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q curl wget git ufw fail2ban

# ── 2. Install Docker ─────────────────────────────────────────────────────────
echo ""
echo "2. Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Docker compose plugin (V2)
apt-get install -y docker-compose-plugin
docker compose version

# ── 3. Firewall ───────────────────────────────────────────────────────────────
echo ""
echo "3. Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # Frontend (HTTP)
ufw allow 443/tcp  # HTTPS (for future Caddy/nginx)
ufw allow 3000/tcp # Backend API (optional, can restrict later)
ufw --force enable
ufw status

# ── 4. Create deploy directory ────────────────────────────────────────────────
echo ""
echo "4. Creating /opt/easymod..."
mkdir -p /opt/easymod
cd /opt/easymod

# ── 5. Download docker-compose.prod.yml ───────────────────────────────────────
echo ""
echo "5. Fetching docker-compose.prod.yml from GitHub..."
# This requires the repo to have the file; alternatively scp it separately
echo "   → Copy docker-compose.prod.yml and .env.prod manually to /opt/easymod/"
echo "   scp EasyMod-backend/docker-compose.prod.yml root@\$(hostname -I | awk '{print \$1}'):/opt/easymod/"
echo "   scp EasyMod-backend/.env.prod root@\$(hostname -I | awk '{print \$1}'):/opt/easymod/"

# ── 6. Authenticate to ghcr.io ───────────────────────────────────────────────
echo ""
echo "6. (After copying files) Authenticate to GitHub Container Registry:"
echo "   echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin"

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. scp docker-compose.prod.yml and .env.prod to /opt/easymod/"
echo "  2. docker login ghcr.io"
echo "  3. cd /opt/easymod && docker compose -f docker-compose.prod.yml up -d"
echo "  4. docker compose -f docker-compose.prod.yml exec backend npm run db:sync"
echo "  5. docker compose -f docker-compose.prod.yml exec backend npm run migrate"
echo "  6. docker compose -f docker-compose.prod.yml exec backend npm run seed:admin"
echo "  7. curl http://localhost:3000/health/ready"
