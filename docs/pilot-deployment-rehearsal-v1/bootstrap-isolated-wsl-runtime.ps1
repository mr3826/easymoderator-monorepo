[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Provision a fresh WSL2 distro on D:. This never uses Docker Desktop's engine.
$DistroName = 'EasyModPilotRehearsalV1'
$RuntimeRoot = 'D:\easymod-runtime\pilot-deployment-rehearsal-v1'
$DistroRoot = Join-Path $RuntimeRoot 'wsl'
$BootstrapRoot = Join-Path $RuntimeRoot 'bootstrap'
$RootfsName = 'ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz'
$RootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/noble/current/$RootfsName"
$RootfsSha256 = '2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934'
$RootfsPath = Join-Path $BootstrapRoot $RootfsName
$ManifestPath = Join-Path $RuntimeRoot 'runtime-manifest.json'
$InstallerPath = Join-Path $PSScriptRoot 'install-wsl-docker-runtime.sh'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (-not $RepoRoot.StartsWith('D:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Expected the rehearsal worktree on D:, found $RepoRoot."
}
if (Test-Path -LiteralPath $RuntimeRoot) {
    throw "Refusing to reuse existing runtime path: $RuntimeRoot"
}
if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "Missing Linux installer: $InstallerPath"
}

$LxssRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
if (Test-Path $LxssRoot) {
    $RegisteredDistro = Get-ChildItem -LiteralPath $LxssRoot | ForEach-Object {
        Get-ItemProperty -LiteralPath $_.PSPath
    } | Where-Object { $_.DistributionName -eq $DistroName }
    if ($RegisteredDistro) {
        throw "Refusing to reuse registered WSL distro: $DistroName"
    }
}

$DockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
if ($DockerService -and $DockerService.Status -ne 'Stopped') {
    throw 'Docker Desktop service is active; this bootstrap will not touch it.'
}
$DockerProcesses = Get-Process -Name 'com.docker.backend','Docker Desktop' -ErrorAction SilentlyContinue
if ($DockerProcesses) {
    throw 'Docker Desktop processes are active; this bootstrap will not touch them.'
}
$BusyPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(54580, 54543) }
if ($BusyPorts) {
    throw 'A planned loopback preview port is already listening.'
}

$DriveD = Get-PSDrive -Name D
if ($DriveD.Free -lt 30GB) {
    throw "At least 30 GB free space is required on D:. Found $($DriveD.Free) bytes."
}
$OperatingSystem = Get-CimInstance Win32_OperatingSystem
$FreeMemoryBytes = [long]$OperatingSystem.FreePhysicalMemory * 1024
if ($FreeMemoryBytes -lt 4GB) {
    throw "At least 4 GB free physical memory is required. Found $FreeMemoryBytes bytes."
}

$WslEnvNames = @(($env:WSLENV -split ':') | ForEach-Object {
    $Parts = $_ -split '/'
    $Parts[0]
})
if ($WslEnvNames -contains 'EM_OPENAI_KEY' -or $WslEnvNames -contains 'EM_GEMINI_KEY') {
    throw 'Provider credential aliases are exported through WSLENV; aborting.'
}

# The WSL runtime must receive only synthetic provider placeholders.
$RehearsalEnvPath = Join-Path $RepoRoot '.env.pilot-rehearsal'
if (-not (Test-Path -LiteralPath $RehearsalEnvPath)) {
    throw 'The ignored synthetic rehearsal env file is missing; render it before provisioning.'
}
$RehearsalEnvLines = [System.IO.File]::ReadAllLines($RehearsalEnvPath)
$ProviderEntries = @{}
foreach ($Line in $RehearsalEnvLines) {
    if ($Line -match '^(OPENAI_API_KEY|GEMINI_API_KEY)=(.*)$') {
        $ProviderEntries[$Matches[1]] = $Matches[2]
    }
}
foreach ($ProviderName in @('OPENAI_API_KEY', 'GEMINI_API_KEY')) {
    if ($ProviderEntries[$ProviderName] -ne 'synthetic-pilot-rehearsal-disabled') {
        throw "$ProviderName is not set to the approved nonfunctional rehearsal placeholder."
    }
}
$WindowsProviderValues = @(
    [Environment]::GetEnvironmentVariable('EM_OPENAI_KEY', [EnvironmentVariableTarget]::Process),
    [Environment]::GetEnvironmentVariable('EM_GEMINI_KEY', [EnvironmentVariableTarget]::Process),
    [Environment]::GetEnvironmentVariable('EM_OPENAI_KEY', [EnvironmentVariableTarget]::User),
    [Environment]::GetEnvironmentVariable('EM_GEMINI_KEY', [EnvironmentVariableTarget]::User)
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
foreach ($Line in $RehearsalEnvLines) {
    foreach ($ProviderValue in $WindowsProviderValues) {
        if ($Line.Contains($ProviderValue)) {
            throw 'A Windows provider credential value still exists in the rehearsal env file.'
        }
    }
}

New-Item -ItemType Directory -Path $BootstrapRoot -Force | Out-Null
Write-Output "Downloading verified Ubuntu WSL rootfs to $RootfsPath"
Invoke-WebRequest -Uri $RootfsUrl -OutFile $RootfsPath
$ActualSha256 = (Get-FileHash -LiteralPath $RootfsPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualSha256 -ne $RootfsSha256) {
    throw "Ubuntu rootfs checksum mismatch. Expected $RootfsSha256; got $ActualSha256."
}

Write-Output "Importing isolated WSL2 distro $DistroName at $DistroRoot"
& wsl.exe --import $DistroName $DistroRoot $RootfsPath --version 2
if ($LASTEXITCODE -ne 0) {
    throw "wsl --import failed with exit code $LASTEXITCODE. The target path is preserved."
}

$WslConfigPath = Join-Path $BootstrapRoot 'wsl.conf'
[System.IO.File]::WriteAllText(
    $WslConfigPath,
    "[boot]`nsystemd=true`n",
    [System.Text.UTF8Encoding]::new($false)
)
$WslConfigLinux = ($WslConfigPath -replace '^D:\\', '/mnt/d/' -replace '\\', '/')
& wsl.exe -d $DistroName --user root -- install -m 0644 $WslConfigLinux /etc/wsl.conf
if ($LASTEXITCODE -ne 0) {
    throw "Writing per-distro wsl.conf failed with exit code $LASTEXITCODE. The distro is preserved."
}

# Terminate only the named rehearsal distro so its per-distro setting applies.
& wsl.exe --terminate $DistroName
if ($LASTEXITCODE -ne 0) {
    throw "Could not terminate only $DistroName; no other distro was targeted."
}

$RepoLinux = ($RepoRoot -replace '^D:\\', '/mnt/d/' -replace '\\', '/')
$InstallerLinux = "$RepoLinux/docs/pilot-deployment-rehearsal-v1/install-wsl-docker-runtime.sh"
Write-Output 'Installing Docker Engine and Node 20 inside the isolated distro.'
& wsl.exe -d $DistroName --user root -- bash $InstallerLinux
if ($LASTEXITCODE -ne 0) {
    throw "Linux runtime installation failed with exit code $LASTEXITCODE. The distro is preserved."
}

$Manifest = [ordered]@{
    distroName = $DistroName
    installLocation = $DistroRoot
    wslVersion = 2
    rootfsUrl = $RootfsUrl
    rootfsSha256 = $ActualSha256
    linuxInstaller = $InstallerPath
    dockerDesktopEngineUsed = $false
    windowsProviderCredentialsExported = $false
    dockerSocket = 'unix:///var/run/docker.sock inside the named WSL distro'
    createdAt = (Get-Date).ToString('o')
}
[System.IO.File]::WriteAllText(
    $ManifestPath,
    ($Manifest | ConvertTo-Json -Depth 4),
    [System.Text.UTF8Encoding]::new($false)
)
Write-Output "ISOLATED_WSL_RUNTIME=READY; manifest=$ManifestPath"
