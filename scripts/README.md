# Deployment Scripts

This directory contains all scripts needed for deploying EasyMod Backend to AWS EC2.

## 📁 Files Overview

| File | Purpose | When to Use |
|------|---------|-------------|
| `ec2-setup.sh` | Bootstrap EC2 instance | First-time setup only |
| `deploy-helper.ps1` | Interactive deployment helper (Windows) | All deployment tasks |
| `deploy-helper.sh` | Interactive deployment helper (Linux/Mac) | All deployment tasks |
| `generate-secrets.ps1` | Generate GitHub secrets (Windows) | Before first deployment |
| `generate-secrets.sh` | Generate GitHub secrets (Linux/Mac) | Before first deployment |
| `github-secrets-checklist.txt` | Complete list of required secrets | Reference |
| `init-db.sql` | Database initialization | Automatic (via migrations) |

---

## 🚀 Quick Start

### 1. Generate Secrets

**Windows (PowerShell):**
```powershell
cd "d:\Easy Moderator\EasyMod-backend"
.\scripts\generate-secrets.ps1
```

**Linux/Mac/WSL:**
```bash
cd /path/to/EasyMod-backend
bash scripts/generate-secrets.sh
```

This creates a file `secrets-generated-YYYYMMDD-HHMMSS.txt` with all generated secrets.

---

### 2. Bootstrap EC2

**Windows (PowerShell):**
```powershell
$env:SSH_KEY_PATH = "C:\path\to\your-key.pem"
.\scripts\deploy-helper.ps1
# Select: 1 (Bootstrap EC2)
```

**Linux/Mac:**
```bash
export SSH_KEY_PATH="/path/to/your-key.pem"
bash scripts/deploy-helper.sh
# Select: 1 (Bootstrap EC2)
```

**What it does:**
- Installs Docker & Docker Compose
- Installs AWS CLI v2
- Installs Nginx & Certbot
- Creates `/app/easymod-backend` directory
- Adds ubuntu user to docker group

---

### 3. Setup Nginx + SSL

**Using Helper Script:**
```powershell
.\scripts\deploy-helper.ps1
# Select: 2 (Setup Nginx + SSL)
# Enter your domain: api.yourdomain.com
```

**Manual (if needed):**
```bash
ssh -i your-key.pem ubuntu@3.111.186.154

# Copy nginx config
sudo cp /path/to/nginx.minimal.conf /etc/nginx/sites-available/easymod-backend
sudo nano /etc/nginx/sites-available/easymod-backend
# Replace api.example.com with your domain

# Enable site
sudo ln -sf /etc/nginx/sites-available/easymod-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com
```

---

## 🛠️ Helper Script Commands

### deploy-helper.ps1 / deploy-helper.sh

Interactive menu with the following options:

#### Option 1: Bootstrap EC2
- First-time EC2 setup
- Installs all required software
- Run once per instance

#### Option 2: Setup Nginx + SSL
- Configures reverse proxy
- Obtains Let's Encrypt SSL certificate
- Requires DNS to be pointing to EC2

#### Option 3: Test SSH Connection
- Verifies SSH access
- Checks Docker and AWS CLI installation
- Quick connectivity test

#### Option 4: View Deployment Logs
- Shows last 100 lines of backend logs
- Useful for debugging
- Real-time log viewing

#### Option 5: Restart Backend Service
- Restarts only the backend container
- Quick fix for issues
- Doesn't affect database or Redis

#### Option 6: Check Service Status (PowerShell only)
- Shows status of all containers
- Displays ports and health status
- Quick overview of deployment

---

## 📋 Script Details

### ec2-setup.sh

**Purpose:** One-time bootstrap script for Ubuntu 22.04 EC2 instances

**What it installs:**
- Docker CE (latest)
- Docker Compose Plugin
- AWS CLI v2
- Nginx
- Certbot with Nginx plugin
- Required system packages

**Usage:**
```bash
# On EC2 instance
sudo bash /tmp/ec2-setup.sh
```

**Requirements:**
- Ubuntu 22.04 LTS
- Root/sudo access
- Internet connectivity

---

### generate-secrets.ps1 / generate-secrets.sh

**Purpose:** Generate cryptographically secure secrets for GitHub

**What it generates:**
- JWT_ACCESS_SECRET (64 chars)
- JWT_REFRESH_SECRET (64 chars)
- SESSION_SECRET (64 chars)
- PAYMENT_ENCRYPTION_KEY (32 chars)
- POSTGRES_PASSWORD (32 chars with special chars)
- INTERNAL_WEBHOOK_SECRET (32 chars)

**Output:**
- Console display (for immediate use)
- Text file (for reference)

**Security:**
- Uses cryptographically secure random generation
- PowerShell: `Get-Random` with character sets
- Bash: `openssl rand`

**⚠️ Important:** Delete the generated file after adding secrets to GitHub!

---

### deploy-helper.ps1 / deploy-helper.sh

**Purpose:** Interactive deployment management tool

**Features:**
- Menu-driven interface
- SSH key validation
- Error handling
- Color-coded output

**Configuration:**
- EC2 IP: `3.111.186.154`
- EC2 User: `ubuntu`
- SSH Key: Set via `$env:SSH_KEY_PATH` or prompt

**Requirements:**
- SSH client (OpenSSH)
- SCP for file transfers
- Valid SSH key (.pem file)

---

## 🔐 GitHub Secrets Setup

After generating secrets, add them to GitHub:

1. Go to: **GitHub Repository → Settings → Secrets and variables → Actions**
2. Click: **New repository secret**
3. Add each secret from the generated file

### Required Secrets (Total: ~40)

**AWS (5):**
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_REGION
- AWS_ACCOUNT_ID
- ECR_REPOSITORY

**EC2 (3):**
- EC2_HOST
- EC2_USER
- EC2_SSH_KEY

**Generated (6):**
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- SESSION_SECRET
- PAYMENT_ENCRYPTION_KEY
- POSTGRES_PASSWORD
- INTERNAL_WEBHOOK_SECRET

**URLs (4):**
- CORS_ORIGINS
- FRONTEND_URL
- BASE_URL
- EMAIL_FROM

**Third-Party (5+):**
- Google_Gemini_Api_KEY
- PINECONE_API_KEY
- PINECONE_INDEX
- PINECONE_NAMESPACE
- META_WEBHOOK_APP_SECRET (optional)
- META_WEBHOOK_VERIFY_TOKEN (optional)

**Database (3):**
- POSTGRES_DB
- POSTGRES_USER
- POSTGRES_PASSWORD

**Standard (8):**
- PORT
- BODY_SIZE_LIMIT
- ALLOW_SELF_SIGNED_TLS
- JWT_ACCESS_EXPIRES_IN
- JWT_REFRESH_EXPIRES_IN
- EMBEDDING_PROVIDER
- EMBEDDING_MODEL
- GEMINI_EMBEDDING_MODEL

**Optional (9):**
- DATABASE_URL
- REDIS_URL
- WF1_WEBHOOK_URL
- OPENAI_API_KEY
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- SMTP_SECURE

---

## 🐛 Troubleshooting

### SSH Connection Fails

```powershell
# Check key permissions
icacls your-key.pem
# Should show only your user has access

# Test connection manually
ssh -i your-key.pem -v ubuntu@3.111.186.154
```

### Bootstrap Script Fails

```bash
# Check logs
ssh -i your-key.pem ubuntu@3.111.186.154
sudo journalctl -xe

# Verify internet connectivity
ping -c 4 8.8.8.8

# Check disk space
df -h
```

### SSL Certificate Fails

```bash
# Verify DNS
nslookup api.yourdomain.com

# Check Nginx config
sudo nginx -t

# View Certbot logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log
```

### Deployment Logs Show Errors

```powershell
# View full logs
.\scripts\deploy-helper.ps1
# Select: 4 (View logs)

# Or SSH and check
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml logs --tail=200
```

---

## 📚 Additional Resources

- [QUICK_START.md](../QUICK_START.md) - Step-by-step deployment guide
- [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) - Comprehensive deployment documentation
- [github-secrets-checklist.txt](./github-secrets-checklist.txt) - Complete secrets reference

---

## 🔒 Security Best Practices

1. **SSH Keys:**
   - Never commit .pem files to git
   - Set restrictive permissions (400)
   - Store securely (password manager)

2. **Generated Secrets:**
   - Delete generated files after use
   - Never commit to version control
   - Rotate regularly (every 90 days)

3. **GitHub Secrets:**
   - Use repository secrets (not environment)
   - Limit access to repository admins
   - Audit secret usage regularly

4. **EC2 Access:**
   - Use Elastic IP (not public IP)
   - Restrict Security Group rules
   - Enable CloudWatch monitoring

---

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review deployment logs
3. Verify all prerequisites are met
4. Check GitHub Actions logs

---

**EC2 Instance:** `3.111.186.154`  
**Region:** `ap-south-1` (Mumbai)  
**Last Updated:** 2025
