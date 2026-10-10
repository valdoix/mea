<#
  Mea's tray icon on Windows (ARCH-09).

  Shows whether Mea is running, how many background jobs it has, and when it last made a backup,
  with "Open Mea", "Restart", "Update Mea" and "View logs" in its menu. It only talks to Mea's local health
  endpoint (http://127.0.0.1:<port>/api/health); it never needs a password or a pairing.

  install-service.ps1 -Tray starts it at every sign-in. To run it by hand:
    powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts\tray.ps1
#>
param(
  [string]$TaskName = "Mea",
  [int]$Port = 7766,
  [string]$DataDir = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) {
  $DataDir = if (Test-Path (Join-Path $root "dist\data")) { Join-Path $root "dist\data" } else { Join-Path $root "data" }
}
$base = "http://127.0.0.1:$Port"

# One tray icon per sign-in, even if the shortcut runs twice.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\MeaTray-$Port", [ref]$created)
if (-not $created) { exit }

# The app's own icon, tinted grey while Mea isn't answering.
function New-TrayIcon([bool]$dim) {
  $png = Join-Path $root "web\public\icons\favicon-32.png"
  if (-not (Test-Path $png)) { return [System.Drawing.SystemIcons]::Application }
  $bmp = New-Object System.Drawing.Bitmap $png
  if ($dim) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      for ($y = 0; $y -lt $bmp.Height; $y++) {
        $c = $bmp.GetPixel($x, $y)
        $g = [int](($c.R + $c.G + $c.B) / 3)
        $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([int]($c.A * 0.6), $g, $g, $g))
      }
    }
  }
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$iconUp = New-TrayIcon $false
$iconDown = New-TrayIcon $true

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $iconDown
$tray.Text = "Mea: starting…"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("Checking…")
$statusItem.Enabled = $false
$backupItem = $menu.Items.Add("")
$backupItem.Enabled = $false
[void]$menu.Items.Add("-")
$openItem = $menu.Items.Add("Open Mea")
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$statusPage = $menu.Items.Add("Status and jobs")
$restartItem = $menu.Items.Add("Restart")
$updateItem = $menu.Items.Add("Update Mea")
$logsItem = $menu.Items.Add("View logs")
[void]$menu.Items.Add("-")
$quitItem = $menu.Items.Add("Hide this icon")
$tray.ContextMenuStrip = $menu

$openItem.add_Click({ Start-Process $base })
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Process $base } })
$statusPage.add_Click({ Start-Process "$base/settings/status" })
$logsItem.add_Click({
  $logs = Join-Path $DataDir "logs"
  if (-not (Test-Path $logs)) { $logs = $DataDir }
  Start-Process explorer.exe $logs
})
$restartItem.add_Click({
  try {
    # Restarting a Scheduled Task may need the rights it was registered with; schtasks says so if not.
    & schtasks.exe /End /TN $TaskName | Out-Null
    Start-Sleep -Seconds 2
    & schtasks.exe /Run /TN $TaskName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks exited with $LASTEXITCODE" }
    $tray.ShowBalloonTip(3000, "Mea", "Restarting…", [System.Windows.Forms.ToolTipIcon]::Info)
  } catch {
    $tray.ShowBalloonTip(6000, "Mea", "Couldn't restart the '$TaskName' task. Try Task Scheduler, or run this tray as administrator once.", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
})
# Update runs scripts\update.ps1 in its own hidden process so this menu stays responsive,
# and a timer picks up its result file when it's done.
$script:updateProc = $null
$script:updateResult = Join-Path ([System.IO.Path]::GetTempPath()) "mea-update-$Port.json"
$updateTimer = New-Object System.Windows.Forms.Timer
$updateTimer.Interval = 1000
$updateTimer.add_Tick({
  if (-not $script:updateProc -or -not $script:updateProc.HasExited) { return }
  $updateTimer.Stop()
  $script:updateProc = $null
  $updateItem.Text = "Update Mea"
  $updateItem.Enabled = $true
  $result = $null
  try { $result = Get-Content $script:updateResult -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
  if (-not $result) {
    $result = [pscustomobject]@{ ok = $false; message = "The update stopped unexpectedly. See update.log in View logs." }
  }
  $icon = if ($result.ok) { [System.Windows.Forms.ToolTipIcon]::Info } else { [System.Windows.Forms.ToolTipIcon]::Warning }
  $tray.ShowBalloonTip(10000, "Mea", $result.message, $icon)
  $script:wasUp = $null
  Update-Status
})
$updateItem.add_Click({
  if ($script:updateProc) { return }
  Remove-Item $script:updateResult -ErrorAction SilentlyContinue
  $updateScript = Join-Path $root "scripts\update.ps1"
  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$updateScript`" -TaskName `"$TaskName`" -Port $Port -DataDir `"$DataDir`" -ResultFile `"$($script:updateResult)`""
  try {
    $script:updateProc = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  } catch {
    $tray.ShowBalloonTip(6000, "Mea", "Couldn't start the update: $($_.Exception.Message)", [System.Windows.Forms.ToolTipIcon]::Warning)
    return
  }
  $updateItem.Text = "Updating…"
  $updateItem.Enabled = $false
  $tray.ShowBalloonTip(5000, "Mea", "Updating Mea. This can take a minute or two; Mea restarts at the end.", [System.Windows.Forms.ToolTipIcon]::Info)
  $updateTimer.Start()
})
$quitItem.add_Click({
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

function Format-Ago([double]$ms) {
  if (-not $ms) { return "never" }
  $nowMs = ((Get-Date).ToUniversalTime() - [DateTime]'1970-01-01').TotalMilliseconds
  $mins = [int][Math]::Floor(($nowMs - $ms) / 60000)
  if ($mins -lt 1) { return "just now" }
  if ($mins -lt 90) { return "$mins min ago" }
  if ($mins -lt 48 * 60) { return "$([int]($mins / 60)) h ago" }
  return "$([int]($mins / 1440)) days ago"
}

$script:wasUp = $null
function Update-Status {
  $up = $false
  $text = "Mea: not answering"
  try {
    $h = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 3
    $up = [bool]$h.ok
    $jobs = [int]$h.jobs.running
    $queued = 0
    if ($h.jobs.counts.queued) { $queued = [int]$h.jobs.counts.queued }
    $work = if ($jobs -or $queued) { "$jobs working, $queued waiting" } else { "idle" }
    $statusItem.Text = "Running · $work"
    $backupItem.Text = "Last backup: $(Format-Ago $h.lastBackupAt)"
    $text = "Mea: running · $work"
    $nowMs = ((Get-Date).ToUniversalTime() - [DateTime]'1970-01-01').TotalMilliseconds
    $failed = @($h.jobs.recentFailures | Where-Object { $_.updated_at -gt $nowMs - 3600000 }).Count
    if ($failed -gt 0) { $text = "Mea: running · $failed job(s) failed this hour" }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -eq 423) {
      # SEC-05: running, but the encrypted database waits for its passphrase.
      $up = $true
      $text = "Mea: locked (open it to unlock)"
      $statusItem.Text = "Locked: waiting for the passphrase"
      $backupItem.Text = ""
    } else {
      $statusItem.Text = "Not answering on port $Port"
      $backupItem.Text = ""
    }
  }
  # The tooltip can hold 63 characters.
  $tray.Text = if ($text.Length -gt 63) { $text.Substring(0, 63) } else { $text }
  $tray.Icon = if ($up) { $iconUp } else { $iconDown }
  if ($null -ne $script:wasUp -and $script:wasUp -and -not $up -and -not $script:updateProc) {
    $tray.ShowBalloonTip(5000, "Mea", "Mea stopped answering. It restarts on its own within a minute; if not, use Restart.", [System.Windows.Forms.ToolTipIcon]::Warning)
  }
  $script:wasUp = $up
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({ Update-Status })
$timer.Start()
Update-Status

[System.Windows.Forms.Application]::Run()
$timer.Stop()
$tray.Dispose()
$mutex.ReleaseMutex()
