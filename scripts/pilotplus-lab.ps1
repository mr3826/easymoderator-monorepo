<#
.PSYNOPSIS
  Pilot+ V1 founder lab — one command to a reviewable local environment.
.USAGE
  powershell -File scripts\pilotplus-lab.ps1          # start stack + seed + show URLs
  powershell -File scripts\pilotplus-lab.ps1 -Down    # stop lab containers + app processes
#>
param([switch]$Down)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$nodeDir = 'D:\easymod\_local-runtimes\node-v20.20.2\extract\node-v20.20.2-win-x64'
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }

$env:DATABASE_URL = 'postgres://easymod_user:easymod_password@localhost:5432/easymod_dev'
$env:REDIS_URL = 'redis://localhost:6379'

if ($Down) {
    Push-Location "$root\EasyMod-backend"
    docker compose stop postgres redis
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and $_.Path.StartsWith($nodeDir)
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Pop-Location
    Write-Host 'Pilot+ lab stopped. Data survives in the postgres volume.' -ForegroundColor Green
    exit 0
}

$envFile = "$root\EasyMod-backend\.env"
if (-not (Test-Path $envFile)) {
    $secret = -join ((48..57) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    @(
        "NODE_ENV=development"
        "DATABASE_URL=postgres://easymod_user:easymod_password@localhost:5432/easymod_dev"
        "REDIS_URL=redis://localhost:6379"
        "SESSION_SECRET=$secret"
        "JWT_ACCESS_SECRET=${secret}_access"
        "JWT_REFRESH_SECRET=${secret}_refresh"
        "AI_ACTION_GATE_SECRET=${secret}_gate"
        "FRONTEND_URL=http://localhost:5173"
        "CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    ) | Set-Content -Path $envFile -Encoding ascii
    Write-Host '   created local EasyMod-backend\.env (gitignored, dev-only secrets)' -ForegroundColor DarkGreen
}

function Invoke-Step {
    param([string]$Dir, [string]$Cmd, [string]$Okay)
    Push-Location $Dir
    cmd /c "$Cmd 2>&1" | Tee-Object -Variable out | Out-Null
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { $out | Select-Object -Last 12 | ForEach-Object { Write-Host $_ }; throw "Step failed ($Cmd) exit=$code" }
    Write-Host "   $Okay" -ForegroundColor DarkGreen
}

Write-Host '== [1/4] infra (postgres + redis, dedicated easymod-* containers) ==' -ForegroundColor Cyan
Push-Location "$root\EasyMod-backend"
cmd /c "docker compose up -d postgres redis 2>&1" | Out-Null
Pop-Location
Start-Sleep -Seconds 5

Write-Host '== [2/4] migrations ==' -ForegroundColor Cyan
Invoke-Step "$root\EasyMod-backend" 'npm run migrate' 'migrations current'

Write-Host '== [3/4] Pilot+ lab seed (idempotent, synthetic-only) ==' -ForegroundColor Cyan
Invoke-Step "$root\EasyMod-backend" 'npm run seed:pilotplus-lab' 'lab data ready'

Write-Host '== [4/4] app servers (background) ==' -ForegroundColor Cyan
Start-Process -FilePath 'cmd' -WindowStyle Minimized -ArgumentList '/c', "cd /d $root\EasyMod-backend && set START_EMBEDDED_WORKERS=true&& npm run dev > D:\easymod\_tmp\pilotplus-lab-backend.log 2>&1"
Start-Process -FilePath 'cmd' -WindowStyle Minimized -ArgumentList '/c', "cd /d $root\EasyMod-frontend && npm run dev > D:\easymod\_tmp\pilotplus-lab-frontend.log 2>&1"

Start-Sleep -Seconds 25
Write-Host @"

  PILOT+ REVIEW LAB
  -----------------
  Web app      : http://localhost:5173
  API health   : http://localhost:3000/health          (expect 200)
  Shop A (ALL Pilot+ flags ON, AI mode DRAFT):
     owner      pilot.a.owner@lab.easymod.local
     staff      pilot.a.staff@lab.easymod.local
     password   PilotLab@2026!
  Shop B (control, flags OFF, AI mode MANUAL):
     owner      pilot.b.owner@lab.easymod.local
     password   PilotLab@2026!

  Sign in with the OWNER row and pick the shop shown in the shop switcher.
  Journeys + evidence: docs/pilot-plus-v1/10-founder-handoff.md
  Stop everything   : powershell -File scripts\pilotplus-lab.ps1 -Down

"@ -ForegroundColor Green

