#!/usr/bin/env bash
# Generate All GitHub Secrets for EasyMod Backend
# Usage: bash scripts/generate-secrets.sh

set -euo pipefail

echo "=========================================="
echo "EasyMod Backend - Secret Generator"
echo "=========================================="
echo ""
echo "Generating secure random secrets..."
echo ""

# Generate secrets using openssl
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
PAYMENT_ENCRYPTION_KEY=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-32)
INTERNAL_WEBHOOK_SECRET=$(openssl rand -hex 16)

echo "✅ Secrets generated successfully!"
echo ""
echo "=========================================="
echo "COPY THESE TO GITHUB SECRETS"
echo "=========================================="
echo ""

# Display secrets
echo "--- GENERATED SECRETS (Copy each value) ---"
echo ""
echo "JWT_ACCESS_SECRET"
echo "$JWT_ACCESS_SECRET"
echo ""
echo "JWT_REFRESH_SECRET"
echo "$JWT_REFRESH_SECRET"
echo ""
echo "SESSION_SECRET"
echo "$SESSION_SECRET"
echo ""
echo "PAYMENT_ENCRYPTION_KEY"
echo "$PAYMENT_ENCRYPTION_KEY"
echo ""
echo "POSTGRES_PASSWORD"
echo "$POSTGRES_PASSWORD"
echo ""
echo "INTERNAL_WEBHOOK_SECRET"
echo "$INTERNAL_WEBHOOK_SECRET"
echo ""

# Save to file
OUTPUT_FILE="secrets-generated-$(date +%Y%m%d-%H%M%S).txt"

cat > "$OUTPUT_FILE" <<EOF
EasyMod Backend - Generated Secrets
Generated: $(date '+%Y-%m-%d %H:%M:%S')

⚠️ IMPORTANT: Keep this file secure and delete after adding to GitHub!

========================================
GENERATED SECRETS
========================================

JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET

JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET

SESSION_SECRET=$SESSION_SECRET

PAYMENT_ENCRYPTION_KEY=$PAYMENT_ENCRYPTION_KEY

POSTGRES_PASSWORD=$POSTGRES_PASSWORD

INTERNAL_WEBHOOK_SECRET=$INTERNAL_WEBHOOK_SECRET

========================================
AWS CONFIGURATION (Fill these in)
========================================

AWS_ACCESS_KEY_ID=__FILL_ME__
AWS_SECRET_ACCESS_KEY=__FILL_ME__
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=__FILL_ME__
ECR_REPOSITORY=easymod-backend

========================================
EC2 CONFIGURATION
========================================

EC2_HOST=3.111.186.154
EC2_USER=ubuntu
EC2_SSH_KEY=__PASTE_ENTIRE_PEM_FILE_CONTENT__

========================================
APPLICATION URLS (Fill these in)
========================================

CORS_ORIGINS=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
BASE_URL=https://api.yourdomain.com
EMAIL_FROM=noreply@yourdomain.com

========================================
THIRD-PARTY APIs (Fill these in)
========================================

GOOGLE_GEMINI_API_KEY=__FILL_ME__
PINECONE_API_KEY=__FILL_ME__
PINECONE_INDEX=__FILL_ME__
PINECONE_NAMESPACE=default
META_APP_ID=__FILL_ME__
META_APP_SECRET=__FILL_ME__
META_WEBHOOK_VERIFY_TOKEN=__FILL_ME__

========================================
DATABASE CONFIGURATION
========================================

POSTGRES_DB=easymod_prod
POSTGRES_USER=easymod_user
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

========================================
STANDARD VALUES (Use as-is)
========================================

PORT=3000
BODY_SIZE_LIMIT=10mb
ALLOW_SELF_SIGNED_TLS=false
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=text-embedding-3-small
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
QDRANT_VECTOR_SIZE=384

========================================
OPTIONAL (Leave blank if not using)
========================================

DATABASE_URL=
REDIS_URL=
WF1_WEBHOOK_URL=
OPENAI_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false

EOF

echo "=========================================="
echo ""
echo "✅ Secrets saved to: $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "1. Open the file and fill in the __FILL_ME__ values"
echo "2. Go to GitHub → Settings → Secrets and variables → Actions"
echo "3. Add each secret as a 'New repository secret'"
echo "4. Delete the file after adding all secrets to GitHub"
echo ""
echo "⚠️  SECURITY: Delete $OUTPUT_FILE after use!"
echo ""
