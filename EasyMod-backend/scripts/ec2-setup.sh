#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo bash scripts/ec2-setup.sh
# One-time bootstrap for Ubuntu 22.04 EC2 host.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/ec2-setup.sh"
  exit 1
fi

apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release unzip nginx certbot python3-certbot-nginx

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
  unzip -qo /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
fi

systemctl enable docker
systemctl start docker

if id -u ubuntu >/dev/null 2>&1; then
  usermod -aG docker ubuntu
fi

mkdir -p /home/ubuntu/easymod-backend
chown -R ubuntu:ubuntu /home/ubuntu/easymod-backend

echo "Bootstrap complete. Re-login to apply docker group membership for ubuntu user."
