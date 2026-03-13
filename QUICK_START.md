# Quick Deployment Checklist

**EC2 IP:** `3.111.186.154`

## ✅ Pre-Deployment Checklist

### 1. AWS Setup
- [ ] ECR repository created: `easymod-backend` in `ap-south-1`
- [ ] EC2 instance running: t3.medium, Ubuntu 22.04
- [ ] Security Group ports open: 22, 80, 443, 3000
- [ ] SSH key pair (.pem) downloaded and saved
- [ ] AWS Access Key ID & Secret Access Key ready
- [ ] AWS Account ID noted (12 digits)

### 2. Domain Setup
- [ ] Domain purchased/available
- [ ] DNS A record created: `api.yourdomain.com` → `3.111.186.154`
- [ ] DNS propagated (test: `nslookup api.yourdomain.com`)

### 3. Third-Party Services
- [ ] Pinecone account created
- [ ] Pinecone index created
- [ ] Pinecone API key obtained
- [ ] Google Gemini API key obtained
- [ ] Meta Webhook credentials (if using WhatsApp)

---

## 🚀 Deployment Steps

### Step 1: Bootstrap EC2 (5 minutes)

```powershell
# Set your SSH key path
$env:SSH_KEY_PATH = "C:\path\to\your-key.pem"

# Run helper script
cd "d:\Easy Moderator\EasyMod-backend"
.\scripts\deploy-helper.ps1

# Select: 1 (Bootstrap EC2)
```

**Wait for completion, then test connection:**
```powershell
.\scripts\deploy-helper.ps1
# Select: 3 (Test SSH connection)
```

---

### Step 2: Setup Nginx + SSL (3 minutes)

```powershell
.\scripts\deploy-helper.ps1
# Select: 2 (Setup Nginx + SSL)
# Enter your domain: api.yourdomain.com
```

---

### Step 3: Configure GitHub Secrets (10 minutes)

Go to: **GitHub → Your Repo → Settings → Secrets and variables → Actions**

#### Generate Secrets (PowerShell)

```powershell
# JWT Access Secret (64 chars)
Write-Host "JWT_ACCESS_SECRET=" -NoNewline; -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# JWT Refresh Secret (64 chars)
Write-Host "JWT_REFRESH_SECRET=" -NoNewline; -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Session Secret (64 chars)
Write-Host "SESSION_SECRET=" -NoNewline; -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# Payment Encryption Key (32 chars)
Write-Host "PAYMENT_ENCRYPTION_KEY=" -NoNewline; -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})

# Postgres Password (32 chars)
Write-Host "POSTGRES_PASSWORD=" -NoNewline; -join ((48..57) + (65..90) + (97..122) + (33,35,37,38,42,43,45,61,63,64) | Get-Random -Count 32 | ForEach-Object {[char]$_})

# Internal Webhook Secret (32 chars)
Write-Host "INTERNAL_WEBHOOK_SECRET=" -NoNewline; -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

#### Add These Secrets to GitHub:

**AWS (6 secrets)**
```
AWS_ACCESS_KEY_ID=<your-value>
AWS_SECRET_ACCESS_KEY=<your-value>
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=<your-12-digit-id>
ECR_REPOSITORY=easymod-backend
```

**EC2 (3 secrets)**
```
EC2_HOST=3.111.186.154
EC2_USER=ubuntu
EC2_SSH_KEY=<paste-entire-pem-file-content>
```

**Application (Generated above - 6 secrets)**
```
JWT_ACCESS_SECRET=<generated>
JWT_REFRESH_SECRET=<generated>
SESSION_SECRET=<generated>
PAYMENT_ENCRYPTION_KEY=<generated>
POSTGRES_PASSWORD=<generated>
INTERNAL_WEBHOOK_SECRET=<generated>
```

**URLs (4 secrets)**
```
CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
BASE_URL=https://api.yourdomain.com
EMAIL_FROM=noreply@yourdomain.com
```

**Third-Party APIs (5 secrets)**
```
Google_Gemini_Api_KEY=<your-gemini-key>
PINECONE_API_KEY=<your-pinecone-key>
PINECONE_INDEX=<your-index-name>
PINECONE_NAMESPACE=default
META_WEBHOOK_APP_SECRET=<if-using-whatsapp>
META_WEBHOOK_VERIFY_TOKEN=<if-using-whatsapp>
```

**Database (3 secrets)**
```
POSTGRES_DB=easymod_prod
POSTGRES_USER=easymod_user
POSTGRES_PASSWORD=<generated-above>
```

**Standard Values (6 secrets)**
```
PORT=3000
BODY_SIZE_LIMIT=10mb
ALLOW_SELF_SIGNED_TLS=false
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
EMBEDDING_PROVIDER=google
EMBEDDING_MODEL=text-embedding-004
GEMINI_EMBEDDING_MODEL=text-embedding-004
```

**Optional (Leave blank if not using)**
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

### Step 4: Deploy! (2 minutes)

```bash
cd "d:\Easy Moderator\EasyMod-backend"
git add .
git commit -m "chore: production deployment"
git push origin main
```

**Monitor:** GitHub → Actions tab → "Deploy Backend To AWS"

---

### Step 5: Verify (1 minute)

```powershell
# Check service status
.\scripts\deploy-helper.ps1
# Select: 6 (Check service status)

# Test API
curl http://3.111.186.154:3000/health
# OR with domain
curl https://api.yourdomain.com/health
```

---

## 🔧 Common Commands

```powershell
# View logs
.\scripts\deploy-helper.ps1  # Select: 4

# Restart service
.\scripts\deploy-helper.ps1  # Select: 5

# SSH to server
ssh -i your-key.pem ubuntu@3.111.186.154
```

---

## ⚠️ Troubleshooting

### Deployment fails at "SSH to EC2"
- Check EC2_SSH_KEY secret has entire .pem file content
- Verify Security Group allows port 22 from GitHub Actions IPs

### "Connection refused" on port 3000
- Check backend container: `docker compose -f docker-compose.prod.yml ps`
- View logs: `docker compose -f docker-compose.prod.yml logs backend`

### SSL certificate fails
- Ensure DNS is pointing to 3.111.186.154
- Wait 5-10 minutes for DNS propagation
- Check: `nslookup api.yourdomain.com`

### Database migration errors
```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml logs postgres
docker compose -f docker-compose.prod.yml run --rm backend npm run migrate:status
```

---

## 📊 Total Time: ~20 minutes

- Bootstrap EC2: 5 min
- Nginx + SSL: 3 min
- GitHub Secrets: 10 min
- Deploy + Verify: 2 min

---

**Your API will be live at:** `https://api.yourdomain.com` 🎉
