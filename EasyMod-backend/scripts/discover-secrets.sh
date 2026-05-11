#!/usr/bin/env bash
# discover-secrets.sh
# Discovers all existing secrets from GCP Secret Manager and GitHub.
# Outputs a .env.prod.template file with all secret names.
#
# Prerequisites:
#   gcloud CLI authenticated (gcloud auth login)
#   gh CLI authenticated (gh auth login)
#
# Usage:
#   GCP_PROJECT=your-project-id GITHUB_REPO=org/repo ./scripts/discover-secrets.sh

set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:-}"
GITHUB_REPO="${GITHUB_REPO:-}"
OUTPUT_FILE="$(dirname "$0")/../.env.prod.template"

echo "=== Easy Moderator — Secret Discovery ==="
echo ""

# ─── GCP Secret Manager ───────────────────────────────────────────────────────
if [ -n "$GCP_PROJECT" ]; then
    echo "🔍 Fetching secrets from GCP Secret Manager (project: $GCP_PROJECT)..."
    GCP_SECRETS=$(gcloud secrets list --project="$GCP_PROJECT" --format="value(name)" 2>/dev/null || echo "")
    if [ -z "$GCP_SECRETS" ]; then
        echo "   No secrets found or GCP not authenticated."
    else
        echo "   Found GCP secrets:"
        while IFS= read -r secret; do
            # Get the short name (strip project path)
            short=$(echo "$secret" | sed 's|.*/||')
            echo "   - $short"
        done <<< "$GCP_SECRETS"
    fi
    echo ""
fi

# ─── GitHub Secrets ───────────────────────────────────────────────────────────
if [ -n "$GITHUB_REPO" ]; then
    echo "🔍 Fetching secrets from GitHub (repo: $GITHUB_REPO)..."
    GH_SECRETS=$(gh secret list --repo "$GITHUB_REPO" --json name --jq '.[].name' 2>/dev/null || echo "")
    if [ -z "$GH_SECRETS" ]; then
        echo "   No secrets found or GitHub CLI not authenticated."
    else
        echo "   Found GitHub secrets:"
        while IFS= read -r s; do
            echo "   - $s"
        done <<< "$GH_SECRETS"
    fi
    echo ""
fi

# ─── Generate .env.prod.template ─────────────────────────────────────────────
echo "📝 Writing $OUTPUT_FILE ..."
cat > "$OUTPUT_FILE" <<'ENV'
# =============================================================================
# Easy Moderator — Production Environment Template
# Copy to .env.prod and fill in actual values.
# DO NOT commit .env.prod to version control.
# =============================================================================

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://easymod_user:CHANGE_ME@postgres:5432/easymod
POSTGRES_DB=easymod
POSTGRES_USER=easymod_user
POSTGRES_PASSWORD=CHANGE_ME

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_SESSION_DB=0
REDIS_CACHE_DB=1
REDIS_RATELIMIT_DB=2

# ── App ───────────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
APP_URL=https://your-domain.com
CORS_ORIGINS=https://your-domain.com

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=CHANGE_ME_32_CHARS_MIN
JWT_REFRESH_SECRET=CHANGE_ME_32_CHARS_MIN
SESSION_SECRET=CHANGE_ME_32_CHARS_MIN

# ── Encryption ────────────────────────────────────────────────────────────────
CHANNEL_ENCRYPTION_KEY=CHANGE_ME_64_HEX_CHARS
PAYMENT_ENCRYPTION_KEY=CHANGE_ME_32_HEX_CHARS

# ── BKash ─────────────────────────────────────────────────────────────────────
BKASH_BASE_URL=https://checkout.pay.bka.sh/v1.2.0-beta
BKASH_USERNAME=CHANGE_ME
BKASH_PASSWORD=CHANGE_ME
BKASH_APP_KEY=CHANGE_ME
BKASH_APP_SECRET=CHANGE_ME
BKASH_SANDBOX=false

# ── Meta / WhatsApp ───────────────────────────────────────────────────────────
META_APP_ID=CHANGE_ME
META_APP_SECRET=CHANGE_ME
META_WEBHOOK_VERIFY_TOKEN=CHANGE_ME
WHATSAPP_WEBHOOK_URL=https://your-domain.com/api/webhooks/meta

# ── AI / LLM ─────────────────────────────────────────────────────────────────
GEMINI_API_KEY=CHANGE_ME
OPENAI_API_KEY=CHANGE_ME

# ── Vector DB ────────────────────────────────────────────────────────────────
PINECONE_API_KEY=CHANGE_ME
PINECONE_INDEX=easymod-vdb
PINECONE_HOST=CHANGE_ME
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=knowledge_documents
QDRANT_PER_TENANT=true
EMBEDDING_API_URL=CHANGE_ME

# ── Email ─────────────────────────────────────────────────────────────────────
RESEND_API_KEY=CHANGE_ME

# ── Push Notifications ────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY=CHANGE_ME
VAPID_PRIVATE_KEY=CHANGE_ME
VAPID_SUBJECT=mailto:admin@easymod.ai

# ── Monitoring ────────────────────────────────────────────────────────────────
SENTRY_DSN=CHANGE_ME
ENV

echo "   Done → $OUTPUT_FILE"
echo ""
echo "=== Next Steps ==="
echo "1. Copy .env.prod.template to EasyMod-backend/.env.prod"
echo "2. Fill in all CHANGE_ME values"
echo "3. On the DO droplet: scp .env.prod root@<DO_IP>:/opt/easymod/"
echo "4. Add GitHub Actions secrets: DO_HOST, DO_SSH_PRIVATE_KEY, VITE_API_BASE_URL"
