# Mobile dev environment (Phase 2, Lane 0 — mobile/p2-devenv). See docs/mobile/DEV_SETUP.md §1.
#
# Session-scoped only: everything this script sets is scoped to the current PowerShell process
# ($env:...), never written to the machine/user environment (no [Environment]::SetEnvironmentVariable,
# no registry, no shell profile edit). The workstation's own global JAVA_HOME stays untouched.
#
# Usage: from EasyMod-mobile/, run `. .\scripts\dev-env.ps1` (dot-sourced, so the env vars persist
# in your current shell) before any Android build/emulator command.

$ErrorActionPreference = 'Stop'

$JdkPath = 'C:\Program Files\Java\jdk-17'
$AndroidHome = 'D:\Android\Sdk'

if (-not (Test-Path $JdkPath)) {
    throw "dev-env.ps1: expected JDK 17 at '$JdkPath' — see docs/mobile/CURRENT_STATE.md §13 for the verified workstation inventory."
}
if (-not (Test-Path $AndroidHome)) {
    throw "dev-env.ps1: expected Android SDK at '$AndroidHome' — see docs/mobile/CURRENT_STATE.md §13."
}

$env:JAVA_HOME = $JdkPath
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome

# Prepend (not replace) so the rest of the process's PATH is untouched.
$prependPaths = @(
    (Join-Path $JdkPath 'bin'),
    (Join-Path $AndroidHome 'platform-tools'),
    (Join-Path $AndroidHome 'emulator'),
    (Join-Path $AndroidHome 'cmdline-tools\latest\bin')
)
$env:Path = ($prependPaths -join ';') + ';' + $env:Path

Write-Host "dev-env.ps1: JAVA_HOME=$env:JAVA_HOME ANDROID_HOME=$env:ANDROID_HOME (this process only)"
