<#
  Keeps a Pangolin tunnel to Mea open at every boot, so the Android app reaches Mea from anywhere
  at your own address (like https://mea.your-domain.com).

  It copies Newt (Pangolin's connector) to %LOCALAPPDATA%\Mea\newt, writes its config there (your
  site's ID and secret, readable only by you, SYSTEM and Administrators), and registers a Scheduled
  Task, "Mea tunnel (Pangolin)", that runs Newt as you (S4U, no stored password), starts at boot and
  restarts if Newt stops. It also tells Mea the address, so Settings > Devices shows it.

  Before running it, once, on https://app.pangolin.net:
    1. Domains: add your domain (Single Domain / CNAME works) and add the records it shows at your registrar.
    2. Sites: add a Newt site and copy its ID and secret.
    3. Resources: add a public HTTP resource at your address, target the site, http 127.0.0.1:7770
       (Mea's tunnel port, never 7766), and turn Pangolin's own login (Platform SSO) off for it.
    4. Download Newt for Windows from https://github.com/fosrl/newt/releases.

  Then, from PowerShell opened with "Run as administrator":
    powershell -ExecutionPolicy Bypass -File scripts\install-pangolin.ps1 -Id <site id> -Address mea.your-domain.com
  It asks for the secret (it isn't shown or stored anywhere else).
#>
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$Address,
  [string]$Endpoint = "https://app.pangolin.net",
  [string]$Newt = "",
  [string]$TaskName = "Mea tunnel (Pangolin)",
  [int]$MeaPort = 7766,
  [string]$Metrics = "127.0.0.1:2112"
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 may not offer TLS 1.2 by default.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Please run this from PowerShell opened with 'Run as administrator'." }

$Address = ($Address.Trim() -replace '^https?://', '' -replace '/.*$', '')
if ($Address -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { throw "'$Address' doesn't look like an address. Use something like mea.your-domain.com." }

# Find Newt: the -Newt path, then PATH, then the Downloads folder.
if (-not $Newt) {
  foreach ($name in @("newt", "newt_windows_amd64")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $Newt = $cmd.Source; break }
  }
}
if (-not $Newt) {
  $dl = Join-Path $env:USERPROFILE "Downloads\newt_windows_amd64.exe"
  if (Test-Path $dl) { $Newt = $dl }
}
if (-not $Newt -or -not (Test-Path $Newt)) {
  throw "Couldn't find Newt. Download newt_windows_amd64.exe from https://github.com/fosrl/newt/releases, then pass its path with -Newt."
}

$dir = Join-Path $env:LOCALAPPDATA "Mea\newt"
$exe = Join-Path $dir "newt.exe"
$config = Join-Path $dir "config.json"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# A Newt you started by hand would fight the task over the same site.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
$others = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "newt*" })
if ($others.Count -gt 0) {
  Write-Warning "Newt is already running (process $($others.Id -join ', ')), probably in a terminal you started it from."
  $answer = Read-Host "Stop it so the boot task can take over? (y/n)"
  if ($answer -notmatch '^[yY]') { throw "Stopped. Close the other Newt first, then run this again." }
  $others | Stop-Process -Force
  Start-Sleep -Seconds 1
}

if ((Resolve-Path $Newt).Path -ne $exe) { Copy-Item -Force $Newt $exe }

$secure = Read-Host "Site secret (from Pangolin; it won't be shown)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $secret) { throw "No secret entered." }

$json = [ordered]@{ id = $Id.Trim(); secret = $secret.Trim(); endpoint = $Endpoint.Trim() } | ConvertTo-Json
# Newt reads plain UTF-8; Windows PowerShell's -Encoding UTF8 would add a BOM.
[IO.File]::WriteAllText($config, $json, (New-Object Text.UTF8Encoding($false)))
$secret = $null
# Only you, SYSTEM and Administrators can read the secret.
& icacls $config /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null

$action = New-ScheduledTaskAction -Execute $exe -Argument "-config-file `"$config`" -metrics -metrics-admin-addr $Metrics" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Mea: Pangolin tunnel https://$Address (Newt; paired devices only)" | Out-Null
Start-ScheduledTask -TaskName $TaskName

# Tell Mea its address (Settings > Devices shows it and pairing links use it).
try {
  $body = @{ address = "https://$Address" } | ConvertTo-Json
  Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:$MeaPort/api/devices/tunnel-address" -ContentType "application/json" -Body $body -TimeoutSec 10 | Out-Null
  Write-Host "Mea now knows its address: https://$Address" -ForegroundColor Green
} catch {
  Write-Warning "Mea didn't answer on port $MeaPort. Enter https://$Address in Settings > Devices once it's running."
}

Write-Host "Waiting for Newt to connect..."
$ok = $false
for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
  Start-Sleep -Seconds 3
  try {
    $ping = Invoke-RestMethod -Uri "https://$Address/api/ping" -TimeoutSec 10 -MaximumRedirection 0
    if ($ping.app -eq "mea" -and $ping.door -eq "main") {
      Write-Warning "https://$Address reaches Mea's main port, which trusts everything as this computer. In Pangolin, point the resource at 127.0.0.1:7770."
      $ok = $true
    } elseif ($ping.app -eq "mea") {
      Write-Host "Mea is reachable at https://$Address" -ForegroundColor Green
      $ok = $true
    }
  } catch { }
}
if (-not $ok) {
  Write-Warning "https://$Address didn't answer as Mea yet. Check that the site shows Online in Pangolin, the resource targets 127.0.0.1:7770, Pangolin's login is off for it, and Mea is running. Task Scheduler > '$TaskName' > History shows whether Newt started."
}

Write-Host ""
Write-Host "Next: in the Mea app on your phone, enter https://$Address (Settings > Devices > This app > Change address), and pair with a code from Settings > Devices." -ForegroundColor Cyan
Write-Host "If you used ngrok before, its task ('Mea tunnel') can stay as a fallback or be removed in Task Scheduler." -ForegroundColor Cyan
