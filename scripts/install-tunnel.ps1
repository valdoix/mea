<#
  Keeps an ngrok tunnel to Mea open at every boot, so the Android app reaches Mea from anywhere
  without Tailscale.

  It registers a Scheduled Task, "Mea tunnel", that runs ngrok as you (S4U, no stored password),
  starts at boot and restarts if ngrok stops. ngrok forwards to Mea's tunnel port (7770 by default),
  where nothing counts as this computer: every request needs a paired device.

  Before running it, once:
    1. Make a free account at https://ngrok.com and copy your authtoken from the dashboard.
    2. In a normal terminal:  ngrok config add-authtoken <your token>
    3. On the dashboard, open Universal Gateway > Domains and note your free domain
       (something like your-name.ngrok-free.dev).

  Then, from PowerShell opened with "Run as administrator":
    powershell -ExecutionPolicy Bypass -File scripts\install-tunnel.ps1 -Domain your-name.ngrok-free.dev
#>
param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$TaskName = "Mea tunnel",
  [int]$Port = 7770
)

$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this from PowerShell opened with 'Run as administrator'." }

$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) { throw "ngrok isn't installed or isn't on PATH. Install it with: winget install Ngrok.Ngrok" }
# winget installs a link; the task needs the real file.
$item = Get-Item $ngrok
if ($item.LinkType -and $item.Target) { $ngrok = @($item.Target)[0] }

$config = Join-Path $env:LOCALAPPDATA "ngrok\ngrok.yml"
if (-not (Test-Path $config)) { throw "No ngrok config at $config. Run 'ngrok config add-authtoken <your token>' first (in a normal terminal)." }

$Domain = $Domain -replace '^https?://', '' -replace '/.*$', ''

$action = New-ScheduledTaskAction -Execute $ngrok -Argument "http $Port --url https://$Domain --config `"$config`" --log stdout"
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
  -Description "Mea: ngrok tunnel https://$Domain -> 127.0.0.1:$Port (paired devices only)" | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 4
try {
  $ping = Invoke-RestMethod -Uri "https://$Domain/api/ping" -Headers @{ "ngrok-skip-browser-warning" = "1" } -TimeoutSec 10
  if ($ping.ok) { Write-Host "Mea is reachable at https://$Domain" -ForegroundColor Green }
} catch {
  Write-Warning "The tunnel task is registered, but https://$Domain didn't answer yet. Is Mea running? Check Task Scheduler > '$TaskName' > History."
}

Write-Host ""
Write-Host "Next: install the Mea app on your phone, enter https://$Domain, and pair it with a code from Settings > Devices." -ForegroundColor Cyan
