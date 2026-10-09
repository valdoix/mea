<#
  Installs Mea as an always-on background service on Windows (ARCH-10).

  It registers a Scheduled Task that:
    - starts at boot, even when nobody is logged in (runs as you, no stored password: S4U)
    - restarts automatically if Mea crashes
    - has no console window and no time limit

  Run from an elevated PowerShell (Run as administrator):
    powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1

  With -Exe it builds the single-file dist\mea.exe (ARCH-14) and runs that instead of Bun + source.
  Mea's data then lives in dist\data next to the exe (copy your existing data\ folder there first
  if you're switching).

  With -Tray it also puts Mea's icon in the notification area at every sign-in (ARCH-09):
  status, jobs and last backup, with Open, Restart and View logs.
#>
param(
  [string]$TaskName = "Mea",
  [int]$Port = 7766,
  [switch]$Exe,
  [switch]$Tray
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this from PowerShell opened with 'Run as administrator'." }

$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { throw "Bun isn't installed or isn't on PATH. Install it from https://bun.sh first." }

Push-Location $root
try {
  & $bun install --frozen-lockfile
  if ($Exe) {
    Write-Host "Building mea.exe..." -ForegroundColor Cyan
    & $bun scripts/build-exe.ts --hide-console
  } else {
    Write-Host "Building the web app..." -ForegroundColor Cyan
    & $bun run build
  }
  if ($LASTEXITCODE -ne 0) { throw "The build failed." }
} finally { Pop-Location }

if ($Exe) {
  $exePath = Join-Path $root "dist\mea.exe"
  if (-not (Test-Path (Join-Path $root "dist\data")) -and (Test-Path (Join-Path $root "data"))) {
    Write-Warning "Your existing data is in $root\data. The exe uses $root\dist\data; stop Mea and copy the folder over to keep your chats."
  }
  $action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory (Split-Path -Parent $exePath)
} else {
  $action = New-ScheduledTaskAction -Execute $bun -Argument "server/src/index.ts" -WorkingDirectory $root
}
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

if ($Tray) {
  # A shortcut in the user's Startup folder: the tray runs in your session, not in the service's.
  $startup = [Environment]::GetFolderPath("Startup")
  $dataDir = if ($Exe) { Join-Path $root "dist\data" } else { Join-Path $root "data" }
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $startup "Mea tray.lnk"))
  $lnk.TargetPath = (Get-Command powershell.exe).Source
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\tray.ps1`" -TaskName `"$TaskName`" -Port $Port -DataDir `"$dataDir`""
  $lnk.WorkingDirectory = $root
  $lnk.Save()
  Start-Process -FilePath $lnk.TargetPath -ArgumentList $lnk.Arguments -WindowStyle Hidden
  Write-Host "Mea's tray icon is on, and starts whenever you sign in." -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Keep this PC awake: Settings > System > Power > Screen and sleep > 'Never' for sleep when plugged in."
Write-Host "  2. Give Mea a private HTTPS address for your phone (once):  tailscale serve --bg $Port"
Write-Host "  3. Open http://127.0.0.1:$Port here, then Settings > Devices > New pairing code, and scan it with your phone."
