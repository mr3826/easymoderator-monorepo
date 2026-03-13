# EasyMod Backend - Production Deployment Guide

**EC2 Instance IP:** `3.111.186.154`  
**Region:** `ap-south-1` (Mumbai)

---

## Prerequisites Checklist

- [ ] EC2 instance running (t3.medium, Ubuntu 22.04)
- [ ] Security Group allows ports: 22, 80, 443, 3000
- [ ] SSH key pair (.pem file) downloaded
- [ ] ECR repository created: `easymod-backend`
- [ ] Domain DNS A record pointing to EC2 IP
- [ ] AWS credentials (Access Key ID & Secret)

---

## Step 1: Bootstrap EC2 Instance (First Time Only)

### Option A: Using PowerShell Helper (Windows)

```powershell
cd "d:\Easy Moderator\EasyMod-backend"
$env:SSH_KEY_PATH = "C:\path\to\your-key.pem"
.\scripts\deploy-helper.ps1
# Select option 1
```

### Option B: Manual SSH

```bash
# From your local machine
ssh -i your-key.pem ubuntu@3.111.186.154

# On EC2 instance
curl -o /tmp/ec2-setup.sh https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/scripts/ec2-setup.sh
# OR if not pushed to GitHub yet, copy the file content manually

sudo bash /tmp/ec2-setup.sh

# After completion, exit and re-login
exit
ssh -i your-key.pem ubuntu@3.111.186.154
```

**What this installs:**
- Docker & Docker Compose
- AWS CLI v2
- Nginx
- Certbot (for SSL certificates)

---

## Step 2: Setup Domain & SSL

### Prerequisites
- Point your domain's A record to `3.111.186.154`
- Wait for DNS propagation (check with: `nslookup api.yourdomain.com`)

### Setup Nginx + SSL

```powershell
# Using PowerShell helper
.\scripts\deploy-helper.ps1
# Select option 2, enter your domain (e.g., api.yourdomain.com)
```

**OR manually:**

```bash
ssh -i your-key.pem ubuntu@3.111.186.154

# Copy nginx config
sudo nano /etc/nginx/sites-available/easymod-backend
# Paste the content from nginx.minimal.conf and replace api.example.com with your domain

# Enable the site
sudo ln -sf /etc/nginx/sites-available/easymod-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com
```

---

## Step 3: Configure GitHub Secrets

Go to: **GitHub Repository → Settings → Secrets and variables → Actions → New repository secret**

### Required Secrets (Copy from `scripts/github-secrets-checklist.txt`)

#### AWS Configuration
```
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=<your-12-digit-account-id>
ECR_REPOSITORY=easymod-backend
```

#### EC2 Configuration
```
EC2_HOST=3.111.186.154
EC2_USER=ubuntu
EC2_SSH_KEY=<paste-entire-pem-file-content>
```

#### Generate These Locally (Windows PowerShell)
```powershell
# JWT Access Secret
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# JWT Refresh Secret
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Session Secret
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Payment Encryption Key (exactly 32 characters)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})

# Strong Postgres Password
-join ((48..57) + (65..90) + (97..122) + (33,35,37,38,42,43,45,61,63,64) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

#### Application Secrets
```
PORT=3000
NODE_ENV=production
BODY_SIZE_LIMIT=10mb
ALLOW_SELF_SIGNED_TLS=false

CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
FRONTEND_URL=https://yourdomain.com
BASE_URL=https://api.yourdomain.com
EMAIL_FROM=noreply@yourdomain.com

JWT_ACCESS_SECRET=<generated-above>
JWT_REFRESH_SECRET=<generated-above>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
SESSION_SECRET=<generated-above>
PAYMENT_ENCRYPTION_KEY=<generated-above>

INTERNAL_WEBHOOK_SECRET=<generate-random-string>
META_WEBHOOK_APP_SECRET=<from-meta-developer-console>
META_WEBHOOK_VERIFY_TOKEN=<from-meta-developer-console>

EMBEDDING_PROVIDER=google
EMBEDDING_MODEL=text-embedding-004
GEMINI_EMBEDDING_MODEL=text-embedding-004
Google_Gemini_Api_KEY=<your-gemini-api-key>

PINECONE_API_KEY=<your-pinecone-api-key>
PINECONE_INDEX=<your-pinecone-index-name>
PINECONE_NAMESPACE=default

POSTGRES_DB=easymod_prod
POSTGRES_USER=easymod_user
POSTGRES_PASSWORD=<generated-above>
```

#### Optional Secrets (Leave blank if not using)
```
DATABASE_URL=
REDIS_URL=
WF1_WEBHOOK_URL=
OPENAI_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
```

---

## Step 4: Deploy!

```bash
cd "d:\Easy Moderator\EasyMod-backend"
git add .
git commit -m "chore: production deployment setup"
git push origin main
```

**Monitor deployment:**
- Go to GitHub → Your Repository → Actions tab
- Watch the "Deploy Backend To AWS" workflow

**Deployment process:**
1. ✅ Build Docker image
2. ✅ Push to ECR
3. ✅ SSH to EC2
4. ✅ Pull latest image
5. ✅ Start Postgres & Redis
6. ✅ Run database migrations
7. ✅ Start backend service

---

## Step 5: Verify Deployment

### Check Service Status
```powershell
.\scripts\deploy-helper.ps1
# Select option 6
```

### Test API Endpoints
```powershell
# Health check
curl https://api.yourdomain.com/health

# Or with IP (before DNS)
curl http://3.111.186.154:3000/health
```

### View Logs
```powershell
.\scripts\deploy-helper.ps1
# Select option 4
```

---

## Troubleshooting

### SSH Connection Issues
```powershell
# Test connection
.\scripts\deploy-helper.ps1
# Select option 3
```

### Service Not Starting
```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml ps
```

### Database Migration Errors
```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml run --rm backend npm run migrate:status
```

### Restart Services
```powershell
.\scripts\deploy-helper.ps1
# Select option 5
```

---

## Post-Deployment

### Update Environment Variables
1. Update GitHub Secrets
2. Re-deploy: `git commit --allow-empty -m "redeploy" && git push`

### Monitor Logs
```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml logs -f backend
```

### Backup Database
```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U easymod_user easymod_prod > backup.sql
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| SSH to EC2 | `ssh -i your-key.pem ubuntu@3.111.186.154` |
| View logs | `cd /app/easymod-backend && docker compose -f docker-compose.prod.yml logs -f` |
| Restart backend | `cd /app/easymod-backend && docker compose -f docker-compose.prod.yml restart backend` |
| Check status | `cd /app/easymod-backend && docker compose -f docker-compose.prod.yml ps` |
| Run migrations | `cd /app/easymod-backend && docker compose -f docker-compose.prod.yml run --rm backend npm run migrate` |

---

## Security Notes

- ✅ All secrets stored in GitHub Secrets (encrypted)
- ✅ SSL/TLS enabled via Let's Encrypt
- ✅ Docker containers run as non-root user
- ✅ Security headers configured in Nginx
- ✅ Rate limiting enabled in application
- ✅ CORS properly configured

---

**Your API will be live at:** `https://api.yourdomain.com` 🚀
