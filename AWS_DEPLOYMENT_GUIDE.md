# AWS EC2 Deployment Guide

Complete guide for deploying Commerce AI Server on AWS EC2 with PostgreSQL RDS and Redis ElastiCache.

---

## 🏗️ Infrastructure Setup

### 1. RDS PostgreSQL Database

**Create RDS Instance:**
```bash
# Via AWS Console or CLI
aws rds create-db-instance \
  --db-instance-identifier commerce-ai-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password YOUR_SECURE_PASSWORD \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name your-subnet-group \
  --backup-retention-period 7 \
  --publicly-accessible false
```

**Security Group:** Allow port `5432` from EC2 security group

**Connection String:**
```
postgresql://postgres:oN3sKXcA9vFZrQ2mE1Y4D7P8HkWT6M@commerce-ai-db.cvyq4i0wgvgl.ap-south-1.rds.amazonaws.com:5432/commerce_ai
```

---

### 2. ElastiCache Redis

**Create Redis Cluster:**
```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id commerce-ai-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1 \
  --cache-subnet-group-name your-subnet-group \
  --security-group-ids sg-xxxxx
```

**Security Group:** Allow port `6379` from EC2 security group

**Connection String:**
```
redis://commerce-ai-redis.np2zon.0001.aps1.cache.amazonaws.com:6379
```

---

### 3. EC2 Instance Setup

**Launch EC2 Instance:**
- AMI: Ubuntu Server 22.04 LTS
- Instance Type: t3.small or larger
- Storage: 20GB GP3 SSD minimum
- Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)

**Connect to EC2:**
```bash
ssh -i your-key.pem ubuntu@65.1.84.60
```

**Run Setup Script:**
```bash
# Upload and run the setup script
chmod +x scripts/setup-ec2.sh
./scripts/setup-ec2.sh
```

---

## 📦 Application Deployment

### Initial Deployment

**1. Clone Repository:**
```bash
cd /home/ubuntu/commerce-ai
git clone <your-repo-url> server-commerce-ai-dev
cd server-commerce-ai-dev
```

**2. Configure Environment:**
```bash
cp .env.template .env
nano .env
```

Update with your AWS resources:
```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:oN3sKXcA9vFZrQ2mE1Y4D7P8HkWT6M@commerce-ai-db.cvyq4i0wgvgl.ap-south-1.rds.amazonaws.com:5432/commerce_ai
REDIS_URL=redis://commerce-ai-redis.np2zon.0001.aps1.cache.amazonaws.com:6379
JWT_ACCESS_SECRET=216f6d943d8e87c10f3c3314f34d273ba1cd380e881ce028bb3f19dd58a1b744
JWT_REFRESH_SECRET=113da3ba14d9a5b000a40c5adb445a9d1c45c05b566c94dac2a8e6f1752284a0
SESSION_SECRET=a215be064624a8a02fb40048561ac279a4c679110c2380c4f75e8919ac7d349a
CORS_ORIGINS=https://your-amplify-app.amplifyapp.com
META_APP_ID=dummy-meta-app-id
META_APP_SECRET=dummy-meta-app-secret
```

**3. Install Dependencies:**
```bash
npm install --production
```

**4. Run Database Migrations:**
```bash
npm run migrate
```

**5. Seed Admin User (optional):**
```bash
npm run seed:admin
```

**6. Start Application:**
```bash
pm2 start ecosystem.config.js
pm2 save
```

**7. Setup Systemd (optional):**
```bash
sudo cp commerce-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable commerce-ai
sudo systemctl start commerce-ai
```

---

## 🔄 Continuous Deployment

### From Local Machine

```bash
# Set environment variables
export EC2_HOST=65.1.84.60
export EC2_USER=ubuntu
export EC2_KEY=~/.ssh/your-key.pem

# Deploy main branch
chmod +x scripts/deploy-remote.sh
./scripts/deploy-remote.sh main
```

### On EC2 Server

```bash
cd /home/ubuntu/commerce-ai/server-commerce-ai-dev
chmod +x scripts/deploy.sh
./scripts/deploy.sh main
```

---

## 🔒 SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal is configured automatically
sudo certbot renew --dry-run
```

---

## 📊 Monitoring & Logs

### PM2 Monitoring

```bash
# View logs
pm2 logs

# Monitor processes
pm2 monit

# Process status
pm2 status

# Restart specific app
pm2 restart commerce-ai-api
pm2 restart commerce-ai-queue-worker
```

### System Logs

```bash
# Application logs
tail -f /home/ubuntu/commerce-ai/server-commerce-ai-dev/logs/out.log
tail -f /home/ubuntu/commerce-ai/server-commerce-ai-dev/logs/err.log

# Nginx logs
sudo tail -f /var/log/nginx/commerce-ai-access.log
sudo tail -f /var/log/nginx/commerce-ai-error.log

# Systemd logs
sudo journalctl -u commerce-ai -f
```

---

## 🧹 Maintenance

### Database Backups

```bash
# Automated via RDS (configured during setup)
# Manual backup:
pg_dump -h your-rds.amazonaws.com -U postgres commerce_ai > backup.sql
```

### Redis Backup

```bash
# ElastiCache handles automatic snapshots
# Manual snapshot via AWS Console or CLI:
aws elasticache create-snapshot \
  --cache-cluster-id commerce-ai-redis \
  --snapshot-name manual-backup-$(date +%Y%m%d)
```

### Clean Old Job Queue Data

```bash
# Via API or directly on server
node -e "const qm = require('./src/jobs/queue-manager'); qm.cleanup().then(() => process.exit())"
```

---

## 🚨 Troubleshooting

### Database Connection Issues

```bash
# Test connection
psql -h your-rds.amazonaws.com -U postgres -d commerce_ai

# Check security groups
# Ensure EC2 can reach RDS on port 5432
```

### Redis Connection Issues

```bash
# Test connection
redis-cli -h your-elasticache.amazonaws.com ping

# Should return: PONG
```

### Application Not Starting

```bash
# Check PM2 logs
pm2 logs --err

# Check environment variables
pm2 env 0

# Restart with fresh environment
pm2 delete all
pm2 start ecosystem.config.js
```

### High Memory Usage

```bash
# Check process memory
pm2 monit

# Reduce PM2 instances in ecosystem.config.js
# Change from 'max' to specific number like 2
```

---

## 📈 Scaling

### Vertical Scaling
- Upgrade EC2 instance type
- Increase RDS instance size
- Upgrade ElastiCache node type

### Horizontal Scaling
- Use Application Load Balancer (ALB)
- Launch multiple EC2 instances
- Update PM2 instances count in ecosystem.config.js
- Ensure sticky sessions for WebSocket connections

---

## 🔐 Security Best Practices

- ✅ Use AWS Secrets Manager for sensitive credentials
- ✅ Enable RDS encryption at rest
- ✅ Enable Redis AUTH (ElastiCache in-transit encryption)
- ✅ Restrict security groups to minimum required access
- ✅ Use IAM roles instead of hardcoded credentials
- ✅ Enable AWS CloudWatch for monitoring
- ✅ Set up CloudWatch Alarms for critical metrics
- ✅ Regular security updates: `sudo apt-get update && sudo apt-get upgrade`

---

## 📞 Support

For issues or questions, check:
- Application logs: `pm2 logs`
- Health endpoint: `curl http://localhost:3000/health`
- AWS Console for infrastructure status
