# Generate All GitHub Secrets for EasyMod Backend
# Usage: .\scripts\generate-secrets.ps1

Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host "EasyMod Backend - Secret Generator"  -ForegroundColor Cyan
Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host ""
Write-Host "Generating secure random secrets..." -ForegroundColor Yellow
Write-Host ""

# Function to generate random string
function Generate-RandomString {
    param(
        [int]$Length = 64,
        [bool]$IncludeSpecial = $false
    )
    
    if ($IncludeSpecial) {
        $chars = (48..57) + (65..90) + (97..122) + (33,35,37,38,42,43,45,61,63,64)
    } else {
        $chars = (48..57) + (65..90) + (97..122)
    }
    
    return -join ($chars | Get-Random -Count $Length | ForEach-Object {[char]$_})
}

# Generate secrets
$JWT_ACCESS_SECRET = Generate-RandomString -Length 64
$JWT_REFRESH_SECRET = Generate-RandomString -Length 64
$SESSION_SECRET = Generate-RandomString -Length 64
$PAYMENT_ENCRYPTION_KEY = Generate-RandomString -Length 32
$POSTGRES_PASSWORD = Generate-RandomString -Length 32 -IncludeSpecial $true
$INTERNAL_WEBHOOK_SECRET = Generate-RandomString -Length 32

Write-Host "✅ Secrets generated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host "COPY THESE TO GITHUB SECRETS"  -ForegroundColor Cyan
Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host ""

# Display secrets in a format ready to copy
Write-Host "--- GENERATED SECRETS (Copy each value) ---" -ForegroundColor Yellow
Write-Host ""
Write-Host "JWT_ACCESS_SECRET" -ForegroundColor Green
Write-Host $JWT_ACCESS_SECRET
Write-Host ""
Write-Host "JWT_REFRESH_SECRET" -ForegroundColor Green
Write-Host $JWT_REFRESH_SECRET
Write-Host ""
Write-Host "SESSION_SECRET" -ForegroundColor Green
Write-Host $SESSION_SECRET
Write-Host ""
Write-Host "PAYMENT_ENCRYPTION_KEY" -ForegroundColor Green
Write-Host $PAYMENT_ENCRYPTION_KEY
Write-Host ""
Write-Host "POSTGRES_PASSWORD" -ForegroundColor Green
Write-Host $POSTGRES_PASSWORD
Write-Host ""
Write-Host "INTERNAL_WEBHOOK_SECRET" -ForegroundColor Green
Write-Host $INTERNAL_WEBHOOK_SECRET
Write-Host ""

# Save to file
$outputFile = "secrets-generated-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
$secretsContent = @"
EasyMod Backend - Generated Secrets
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

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

GEMINI_API_KEY=__FILL_ME__
GOOGLE_GEMINI_API_KEY=__FILL_ME__
PINECONE_API_KEY=__FILL_ME__
PINECONE_INDEX=__FILL_ME__
PINECONE_NAMESPACE=default
META_WEBHOOK_APP_SECRET=__FILL_ME_IF_USING_WHATSAPP__
META_WEBHOOK_VERIFY_TOKEN=__FILL_ME_IF_USING_WHATSAPP__

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
EMBEDDING_PROVIDER=google
EMBEDDING_MODEL=text-embedding-004
GEMINI_EMBEDDING_MODEL=text-embedding-004

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

"@

$secretsContent | Out-File -FilePath $outputFile -Encoding UTF8

Write-Host "=========================================="  -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Secrets saved to: $outputFile" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Open the file and fill in the __FILL_ME__ values" -ForegroundColor White
Write-Host "2. Go to GitHub → Settings → Secrets and variables → Actions" -ForegroundColor White
Write-Host "3. Add each secret as a 'New repository secret'" -ForegroundColor White
Write-Host "4. Delete the file after adding all secrets to GitHub" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  SECURITY: Delete $outputFile after use!" -ForegroundColor Red
Write-Host ""
