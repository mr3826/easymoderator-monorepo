# EasyMod Backend - CI/CD Deployment Guide

## Overview

Automated deployment using GitHub Actions to AWS EC2 with Docker and ECR.

## Deployment Workflows

### 1. Main Branch (Auto Deploy)
- **Trigger**: Push to `main` branch
- **File**: `.github/workflows/deploy.yml`
- **Process**: Build → Push to ECR → Deploy to EC2

### 2. Production Branch (With Tests)
- **Trigger**: Push to `prod` branch
- **File**: `.github/workflows/deploy-prod.yml`
- **Process**: Test → Build → Push to ECR → Deploy to EC2

## Prerequisites

### AWS Setup
1. **ECR Repository**: Create repository for Docker images
2. **EC2 Instance**: Ubuntu server with Docker installed
3. **IAM User**: With ECR and EC2 permissions
4. **Security Group**: Allow ports 22 (SSH), 3000 (API), 6379 (Redis)

### GitHub Secrets Required

```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=<your-aws-account-id>
ECR_REPOSITORY=easymod-backend

# EC2 Configuration
EC2_HOST=<your-ec2-public-ip>
EC2_USER=ubuntu
EC2_SSH_KEY=<your-private-key-content>

# Application Configuration
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
REDIS_PASSWORD=<redis-password>

# Security
JWT_ACCESS_SECRET=<generate-secure-secret>
JWT_REFRESH_SECRET=<generate-secure-secret>
SESSION_SECRET=<generate-secure-secret>
PAYMENT_ENCRYPTION_KEY=<32-byte-key>

# CORS & URLs
CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
BASE_URL=https://api.yourdomain.com

# Qdrant Vector DB
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=<qdrant-api-key>
QDRANT_COLLECTION=knowledge_documents
QDRANT_VECTOR_SIZE=384

# Email (Optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASS=<password>
EMAIL_FROM=noreply@yourdomain.com
```

## Setup Steps

### 1. Configure GitHub Secrets
```bash
# Go to: Repository → Settings → Secrets and variables → Actions
# Add all secrets listed above
```

### 2. Prepare EC2 Instance
```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@your-ec2-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install AWS CLI
sudo apt update
sudo apt install awscli -y

# Configure AWS CLI
aws configure
```

### 3. Create ECR Repository
```bash
# Using AWS CLI
aws ecr create-repository \
  --repository-name easymod-backend \
  --region ap-south-1

# Or via AWS Console: ECR → Create repository
```

### 4. Deploy
```bash
# Push to main branch
git add .
git commit -m "Deploy to production"
git push origin main

# Or push to prod branch (with tests)
git push origin prod
```

## Deployment Process

### Main Branch Workflow
1. **Checkout**: Clone repository
2. **AWS Login**: Authenticate with ECR
3. **Build**: Create Docker image
4. **Push**: Upload to ECR
5. **Deploy**: SSH to EC2 and run container

### Production Branch Workflow
1. **Test**: Run tests with PostgreSQL
2. **Build**: Create Docker image
3. **Push**: Upload to ECR
4. **Deploy**: SSH to EC2 and run container

## Manual Deployment

### Using Docker
```bash
# On EC2 instance
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.ap-south-1.amazonaws.com

docker pull <account-id>.dkr.ecr.ap-south-1.amazonaws.com/easymod-backend:latest

docker stop backend || true
docker rm backend || true

docker run -d \
  --name backend \
  -p 3000:3000 \
  --restart unless-stopped \
  --env-file .env.prod \
  <account-id>.dkr.ecr.ap-south-1.amazonaws.com/easymod-backend:latest
```

### Using PM2
```bash
# On EC2 instance
cd /home/ubuntu/easymod-backend
git pull origin main
npm install
pm2 reload ecosystem.config.js --env production
```

## Monitoring

### Check Deployment Status
```bash
# GitHub Actions
# Go to: Repository → Actions → View workflow runs

# On EC2
docker ps
docker logs backend -f
```

### Health Check
```bash
curl http://your-ec2-ip:3000/health
```

## Rollback

### Quick Rollback
```bash
# On EC2
docker stop backend
docker rm backend

# Pull previous image (if tagged)
docker pull <account-id>.dkr.ecr.ap-south-1.amazonaws.com/easymod-backend:previous

# Or revert git commit and redeploy
git revert HEAD
git push origin main
```

## Troubleshooting

### Build Fails
- Check Dockerfile syntax
- Verify dependencies in package.json
- Review GitHub Actions logs

### Deployment Fails
- Verify EC2 SSH key in secrets
- Check EC2 security group rules
- Ensure Docker is running on EC2

### Container Crashes
```bash
# Check logs
docker logs backend

# Check environment variables
docker exec backend env

# Restart container
docker restart backend
```

## Best Practices

1. **Use Environment Variables**: Never commit secrets
2. **Tag Images**: Use semantic versioning
3. **Health Checks**: Implement `/health` endpoint
4. **Logging**: Use structured logging
5. **Monitoring**: Set up CloudWatch or similar
6. **Backups**: Regular database backups
7. **SSL/TLS**: Use HTTPS in production

## Security Checklist

- [ ] All secrets in GitHub Secrets
- [ ] EC2 security group configured
- [ ] SSH key access restricted
- [ ] Database credentials rotated
- [ ] Redis password set
- [ ] JWT secrets generated
- [ ] CORS origins configured
- [ ] Rate limiting enabled
- [ ] SSL/TLS certificates installed

## Quick Commands

```bash
# View logs
docker logs backend -f

# Restart container
docker restart backend

# Update and redeploy
git pull && docker-compose up -d --build

# Check container status
docker ps

# Execute commands in container
docker exec -it backend npm run migrate
```

## Support

For issues or questions:
- Check GitHub Actions logs
- Review EC2 instance logs
- Verify all secrets are set correctly
- Ensure EC2 has sufficient resources
