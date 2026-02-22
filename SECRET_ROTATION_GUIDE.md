# P0-1: Secret Rotation and Git History Cleanup

## Immediate Actions Required

### 1. Rotate ALL Leaked Credentials

Rotate these credentials in their respective dashboards/APIs. Do NOT reuse old values.

| Credential | Where to Rotate | Notes |
|------------|-----------------|-------|
| **OPENAI_API_KEY** | https://platform.openai.com/api-keys | Revoke old key, create new |
| **Google_Gemini_Api_KEY** | https://aistudio.google.com/apikey | Regenerate |
| **SMTP_PASS** | Your email provider (e.g. Gmail App Passwords) | Create new app password |
| **RDS password** (in DATABASE_URL) | AWS RDS Console → Modify → Master password | Update connection string |
| **JWT_ACCESS_SECRET** | Generate new: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` | |
| **JWT_REFRESH_SECRET** | Same as above | |
| **SESSION_SECRET** | Same as above | |
| **PAYMENT_ENCRYPTION_KEY** | 32 bytes: `require('crypto').randomBytes(32).toString('hex')` | Re-encrypt existing data if needed |
| **REDIS_PASSWORD** | Redis CLI / ElastiCache | If Redis was exposed |

### 2. Remove .env.production from Git History

**Option A: Using git-filter-repo (recommended)**

```bash
# Install: pip install git-filter-repo
git filter-repo --path .env.production --invert-paths --force
```

**Option B: Using BFG Repo-Cleaner**

```bash
# Download BFG from https://rtyley.github.io/bfg-repo-cleaner/
bfg --delete-files .env.production
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

### 3. Force-push and Coordinate

```bash
git push --force origin master
```

**⚠️ WARNING**: Force-push rewrites history. All collaborators must re-clone or rebase. Communicate before doing this.

### 4. Verify .gitignore

Ensure these are in `.gitignore` (already present):

```
.env
.env.*
!.env.example
```

### 5. Use Secrets Management

- **AWS**: Store secrets in AWS Secrets Manager or SSM Parameter Store
- **Production**: Never commit secrets. Use env vars or secret managers at deploy time.
