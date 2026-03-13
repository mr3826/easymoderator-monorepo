# 🚀 EasyMod Backend - Deployment Summary

**Status:** Ready to Deploy  
**EC2 IP:** `3.111.186.154`  
**Region:** `ap-south-1` (Mumbai)  
**Instance Type:** t3.medium, Ubuntu 22.04 LTS

---

## ✅ What's Ready

All deployment infrastructure is configured:

- ✅ GitHub Actions workflow (`.github/workflows/deploy.yml`)
- ✅ EC2 bootstrap script (`scripts/ec2-setup.sh`)
- ✅ Nginx configuration (`nginx.minimal.conf`)
- ✅ Docker setup (`Dockerfile`, `docker-compose.prod.yml`)
- ✅ Deployment helper scripts (PowerShell & Bash)
- ✅ Secret generation scripts
- ✅ Complete documentation

---

## 🎯 Deployment in 4 Steps

### Step 1: Generate Secrets (2 minutes)

```powershell
cd "d:\Easy Moderator\EasyMod-backend"
.\scripts\generate-secrets.ps1
```

This creates a file with all your secrets. Keep it safe!

---

### Step 2: Bootstrap EC2 (5 minutes)

```powershell
$env:SSH_KEY_PATH = "C:\path\to\your-key.pem"
.\scripts\deploy-helper.ps1
# Select: 1 (Bootstrap EC2)
```

**What happens:**
- Installs Docker, AWS CLI, Nginx, Certbot
- Sets up deployment directory
- Configures permissions

**Verify:**
```powershell
.\scripts\deploy-helper.ps1
# Select: 3 (Test SSH connection)
```

---

### Step 3: Configure GitHub (10 minutes)

#### A. Add Secrets to GitHub

Go to: **GitHub → Your Repo → Settings → Secrets and variables → Actions**

Open the generated `secrets-generated-*.txt` file and add each secret.

**Critical Secrets to Fill:**
- `AWS_ACCESS_KEY_ID` - From AWS IAM
- `AWS_SECRET_ACCESS_KEY` - From AWS IAM
- `AWS_ACCOUNT_ID` - Your 12-digit AWS account ID
- `EC2_SSH_KEY` - Entire content of your .pem file
- `Google_Gemini_Api_KEY` - From Google AI Studio
- `PINECONE_API_KEY` - From Pinecone dashboard
- `PINECONE_INDEX` - Your Pinecone index name
- `CORS_ORIGINS` - Your frontend URL(s)
- `FRONTEND_URL` - Your frontend URL
- `BASE_URL` - Your API URL (https://api.yourdomain.com)
- `EMAIL_FROM` - Your email address

**Auto-generated (already in file):**
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- SESSION_SECRET
- PAYMENT_ENCRYPTION_KEY
- POSTGRES_PASSWORD
- INTERNAL_WEBHOOK_SECRET

#### B. Setup Domain (if using custom domain)

1. Point DNS A record: `api.yourdomain.com` → `3.111.186.154`
2. Wait for DNS propagation (5-10 minutes)
3. Verify: `nslookup api.yourdomain.com`

#### C. Setup SSL (if using custom domain)

```powershell
.\scripts\deploy-helper.ps1
# Select: 2 (Setup Nginx + SSL)
# Enter: api.yourdomain.com
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

**Deployment Flow:**
1. ✅ Build Docker image
2. ✅ Push to ECR
3. ✅ SSH to EC2
4. ✅ Pull image
5. ✅ Start Postgres & Redis
6. ✅ Run migrations
7. ✅ Start backend

---

## 🧪 Verify Deployment

### Check Service Status

```powershell
.\scripts\deploy-helper.ps1
# Select: 6 (Check service status)
```

### Test API

```powershell
# With IP (works immediately)
curl http://3.111.186.154:3000/health

# With domain (after DNS + SSL setup)
curl https://api.yourdomain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX...",
  "uptime": 123.45
}
```

### View Logs

```powershell
.\scripts\deploy-helper.ps1
# Select: 4 (View deployment logs)
```

---

## 📊 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub Actions                        │
│  (Build → Push to ECR → Deploy to EC2)                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    AWS ECR (Mumbai)                          │
│  Repository: easymod-backend                                 │
│  Images: Tagged with commit SHA + latest                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              EC2 Instance (3.111.186.154)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Nginx (Port 80/443)               │   │
│  │  - Reverse Proxy                                     │   │
│  │  - SSL/TLS Termination                               │   │
│  │  - Security Headers                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Docker Compose (3 containers)                │   │
│  │                                                       │   │
│  │  ┌──────────────────────────────────────────────┐  │   │
│  │  │  Backend (Node.js)                            │  │   │
│  │  │  - Express API                                │  │   │
│  │  │  - Port 3000                                  │  │   │
│  │  │  - Health checks                              │  │   │
│  │  └──────────────────────────────────────────────┘  │   │
│  │                                                       │   │
│  │  ┌──────────────────────────────────────────────┐  │   │
│  │  │  PostgreSQL 15                                │  │   │
│  │  │  - Primary database                           │  │   │
│  │  │  - Persistent volume                          │  │   │
│  │  └──────────────────────────────────────────────┘  │   │
│  │                                                       │   │
│  │  ┌──────────────────────────────────────────────┐  │   │
│  │  │  Redis 7                                      │  │   │
│  │  │  - Session store                              │  │   │
│  │  │  - Cache layer                                │  │   │
│  │  │  - Rate limiting                              │  │   │
│  │  └──────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
│  - Pinecone (Vector DB)                                      │
│  - Google Gemini (Embeddings)                                │
│  - Meta WhatsApp (Optional)                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Common Operations

### View Logs
```powershell
.\scripts\deploy-helper.ps1  # Select: 4
```

### Restart Backend
```powershell
.\scripts\deploy-helper.ps1  # Select: 5
```

### Check Status
```powershell
.\scripts\deploy-helper.ps1  # Select: 6
```

### SSH to Server
```powershell
ssh -i your-key.pem ubuntu@3.111.186.154
```

### Manual Container Management
```bash
cd /app/easymod-backend
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

---

## 🐛 Troubleshooting

### Deployment Fails

**Check GitHub Actions logs:**
- GitHub → Actions tab → Click on failed workflow
- Look for error messages in each step

**Common issues:**
- Missing GitHub secrets → Add all required secrets
- Wrong EC2_SSH_KEY format → Paste entire .pem file content
- ECR repository doesn't exist → Create in AWS Console
- Security Group blocks SSH → Allow port 22 from GitHub IPs

### Backend Not Starting

```bash
ssh -i your-key.pem ubuntu@3.111.186.154
cd /app/easymod-backend

# Check container status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs backend

# Check environment
docker compose -f docker-compose.prod.yml exec backend env | grep -i database
```

### Database Connection Issues

```bash
# Check Postgres is running
docker compose -f docker-compose.prod.yml ps postgres

# View Postgres logs
docker compose -f docker-compose.prod.yml logs postgres

# Test connection
docker compose -f docker-compose.prod.yml exec postgres psql -U easymod_user -d easymod_prod -c "SELECT 1;"
```

### SSL Certificate Issues

```bash
# Check DNS
nslookup api.yourdomain.com

# Test Nginx config
sudo nginx -t

# View Certbot logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log

# Retry certificate
sudo certbot --nginx -d api.yourdomain.com --force-renewal
```

---

## 📈 Monitoring & Maintenance

### Health Checks

The backend includes a health endpoint:
```bash
curl http://3.111.186.154:3000/health
```

### Log Rotation

Docker automatically manages log rotation. To view:
```bash
docker compose -f docker-compose.prod.yml logs --tail=100 backend
```

### Database Backups

```bash
# Create backup
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U easymod_user easymod_prod > backup-$(date +%Y%m%d).sql

# Restore backup
docker compose -f docker-compose.prod.yml exec -T postgres psql -U easymod_user easymod_prod < backup-20250101.sql
```

### Update Deployment

```bash
# Make changes to code
git add .
git commit -m "feat: your changes"
git push origin main

# GitHub Actions will automatically deploy
```

---

## 🔐 Security Checklist

- ✅ All secrets in GitHub Secrets (encrypted)
- ✅ SSL/TLS enabled (Let's Encrypt)
- ✅ Security headers configured (Nginx)
- ✅ Docker containers run as non-root
- ✅ Rate limiting enabled
- ✅ CORS properly configured
- ✅ Environment variables not in code
- ✅ SSH key permissions restricted
- ✅ Security Group rules minimal

---

## 📚 Documentation

- [QUICK_START.md](./QUICK_START.md) - Fast deployment guide
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Detailed instructions
- [scripts/README.md](./scripts/README.md) - Script documentation
- [scripts/github-secrets-checklist.txt](./scripts/github-secrets-checklist.txt) - Secrets reference

---

## 🎉 Success Criteria

Your deployment is successful when:

- ✅ GitHub Actions workflow completes without errors
- ✅ All 3 containers are running (backend, postgres, redis)
- ✅ Health endpoint returns 200 OK
- ✅ API accessible via domain (if configured)
- ✅ Database migrations completed
- ✅ Logs show no errors

---

## 📞 Next Steps

After successful deployment:

1. **Test all API endpoints** - Use Postman/curl
2. **Setup monitoring** - CloudWatch, Datadog, etc.
3. **Configure backups** - Automated database backups
4. **Setup CI/CD for frontend** - Deploy frontend to Amplify/Vercel
5. **Configure custom domain** - Point frontend to backend API
6. **Setup error tracking** - Sentry, Rollbar, etc.
7. **Load testing** - Ensure performance under load

---

**Your API is ready to serve traffic! 🚀**

**Base URL:** `http://3.111.186.154:3000` (or `https://api.yourdomain.com` with SSL)  
**Health Check:** `/health`  
**API Docs:** `/api-docs` (if configured)

---

**Deployment Time:** ~20 minutes  
**Estimated Cost:** ~$30-40/month (t3.medium + data transfer)  
**Uptime Target:** 99.9%
