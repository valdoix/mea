<#
  Installs Mea as an always-on background service on Windows (ARCH-10).

  It registers a Scheduled Task that:
    - starts at boot, even when nobody is logged in (runs as you, no stored password: S4U)
    - restarts automatically if Mea crashes
    - has no console window and no time limit

  Run from an elevated PowerShell (Run as administrator):
    powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
#>
param(
  [string]$TaskName = "Mea",
  [int]$Port = 7766
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this from PowerShell opened with 'Run as administrator'." }

$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { throw "Bun isn't installed or isn't on PATH. Install it from https://bun.sh first." }

Write-Host "Building the web app..." -ForegroundColor Cyan
Push-Location $root
try {
  & $bun install --frozen-lockfile
  & $bun run build
} finally { Pop-Location }

$action = New-ScheduledTaskAction -Execute $bun -Argument "server/src/index.ts" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Mea: personal roleplay server (http://127.0.0.1:$Port)" | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 3
try {
  $ping = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 5
  if ($ping.ok) { Write-Host "Mea is running at http://127.0.0.1:$Port" -ForegroundColor Green }
} catch {
  Write-Warning "The task is registered but Mea didn't answer yet. Check Task Scheduler > '$TaskName' > History."
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Keep this PC awake: Settings > System > Power > Screen and sleep > 'Never' for sleep when plugged in."
Write-Host "  2. Give Mea a private HTTPS address for your phone (once):  tailscale serve --bg $Port"
Write-Host "  3. Open http://127.0.0.1:$Port here, then Settings > Devices > New pairing code, and scan it with your phone."
