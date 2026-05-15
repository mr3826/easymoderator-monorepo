# EasyMod Backend Deployment Helper for Windows
# Usage: .\scripts\deploy-helper.ps1

$EC2_IP = "3.111.186.154"
$EC2_USER = "ubuntu"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "EasyMod Backend Deployment Helper" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "EC2 Instance: $EC2_IP" -ForegroundColor Yellow
Write-Host ""

# Check if SSH key path is provided
if (-not $env:SSH_KEY_PATH) {
    $SSH_KEY_PATH = Read-Host "Enter path to your .pem key file"
} else {
    $SSH_KEY_PATH = $env:SSH_KEY_PATH
}

if (-not (Test-Path $SSH_KEY_PATH)) {
    Write-Host "Error: SSH key not found at $SSH_KEY_PATH" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Select an action:" -ForegroundColor Green
Write-Host "1) Bootstrap EC2 (first-time setup)"
Write-Host "2) Setup Nginx + SSL"
Write-Host "3) Test SSH connection"
Write-Host "4) View deployment logs"
Write-Host "5) Restart backend service"
Write-Host "6) Check service status"
Write-Host ""
$choice = Read-Host "Enter choice [1-6]"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Bootstrapping EC2 instance..." -ForegroundColor Yellow
        Write-Host "This will install Docker, AWS CLI, Nginx, and Certbot" -ForegroundColor Yellow
        Write-Host ""
        
        # Upload the setup script
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            scripts/ec2-setup.sh "${EC2_USER}@${EC2_IP}:/tmp/"
        
        # Run the setup script
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" "sudo bash /tmp/ec2-setup.sh"
        
        Write-Host ""
        Write-Host "✅ Bootstrap complete!" -ForegroundColor Green
        Write-Host "Please re-login to apply docker group membership:" -ForegroundColor Yellow
        Write-Host "ssh -i $SSH_KEY_PATH ${EC2_USER}@${EC2_IP}" -ForegroundColor Cyan
    }
    
    "2" {
        Write-Host ""
        $API_DOMAIN = Read-Host "Enter your API domain (e.g., api.yourdomain.com)"
        
        if ([string]::IsNullOrWhiteSpace($API_DOMAIN)) {
            Write-Host "Error: Domain is required" -ForegroundColor Red
            exit 1
        }
        
        # Create temporary nginx config with the domain
        $TMP_NGINX = "$env:TEMP\nginx-easymod.conf"
        (Get-Content nginx.minimal.conf) -replace 'api.example.com', $API_DOMAIN | Set-Content $TMP_NGINX
        
        # Upload nginx config
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            $TMP_NGINX "${EC2_USER}@${EC2_IP}:/tmp/easymod-backend"
        
        # Setup nginx and SSL
        $sshCommands = @"
sudo mv /tmp/easymod-backend /etc/nginx/sites-available/easymod-backend
sudo ln -sf /etc/nginx/sites-available/easymod-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
echo ""
echo "Nginx configured. Now running Certbot for SSL..."
sudo certbot --nginx -d $API_DOMAIN --non-interactive --agree-tos --register-unsafely-without-email || true
"@
        
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" $sshCommands
        
        Remove-Item $TMP_NGINX -ErrorAction SilentlyContinue
        Write-Host ""
        Write-Host "✅ Nginx and SSL setup complete!" -ForegroundColor Green
    }
    
    "3" {
        Write-Host ""
        Write-Host "Testing SSH connection..." -ForegroundColor Yellow
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" "echo '✅ SSH connection successful!' && docker --version && aws --version"
    }
    
    "4" {
        Write-Host ""
        Write-Host "Fetching deployment logs..." -ForegroundColor Yellow
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" "cd /app/easymod-backend && docker compose -f docker-compose.prod.yml logs --tail=100 backend"
    }
    
    "5" {
        Write-Host ""
        Write-Host "Restarting backend service..." -ForegroundColor Yellow
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" "cd /app/easymod-backend && docker compose -f docker-compose.prod.yml restart backend"
        Write-Host "✅ Backend restarted!" -ForegroundColor Green
    }
    
    "6" {
        Write-Host ""
        Write-Host "Checking service status..." -ForegroundColor Yellow
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            "${EC2_USER}@${EC2_IP}" "cd /app/easymod-backend && docker compose -f docker-compose.prod.yml ps"
    }
    
    default {
        Write-Host "Invalid choice" -ForegroundColor Red
        exit 1
    }
}
