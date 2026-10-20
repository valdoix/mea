<#
  Updates the Mea on this PC to the latest version and restarts it.

  It pulls the latest code from main (switching back to main first when the folder was left on a
  branch that's already merged), installs packages, rebuilds the web app (or mea.exe, when the "Mea"
  task runs that), then restarts the "Mea" Scheduled Task and waits for Mea to answer again.
  It always rebuilds and restarts, even with nothing new to pull, so commits made right in this
  folder reach the running Mea too. If the build fails, the code goes back to the version that's
  running, so the next update tries again.

  The tray's and the desktop app's "Update and rebuild" item runs it. To run it by hand:
    powershell -ExecutionPolicy Bypass -File scripts\update.ps1

  Everything it does goes to update.log in Mea's logs folder (the tray's "View logs").
  -ResultFile writes the outcome as JSON ({ ok, updated, message }) for the tray to read;
  -ShowResult shows it in a message box instead.
#>
param(
  [string]$TaskName = "Mea",
  [int]$Port = 7766,
  [string]$DataDir = "",
  [string]$ResultFile = "",
  [switch]$ShowResult,
  # Kept so older callers still work: every run rebuilds now. It also reinstalls packages.
  [switch]$Force
)

# Not "Stop": git and bun write progress to stderr, which Windows PowerShell would treat as an error.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) {
  $DataDir = if (Test-Path (Join-Path $root "dist\data")) { Join-Path $root "dist\data" } else { Join-Path $root "data" }
}
$logDir = Join-Path $DataDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir "update.log"

function Write-Log([string]$line) {
  $stamped = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $line"
  Write-Host $stamped
  Add-Content -Path $log -Value $stamped -Encoding UTF8
}

# Runs a command, logs its output, and returns it; $LASTEXITCODE says whether it worked.
function Invoke-Logged([string]$exe, [string[]]$arguments) {
  Write-Log "> $exe $($arguments -join ' ')"
  $out = @(& $exe @arguments 2>&1 | ForEach-Object { "$_" })
  foreach ($line in $out) { if ($line.Trim()) { Write-Log "  $line" } }
  return $out
}

function Finish([bool]$ok, [bool]$updated, [string]$message) {
  Write-Log $message
  Write-Log "----"
  if ($ResultFile) {
    @{ ok = $ok; updated = $updated; message = $message } | ConvertTo-Json | Set-Content -Path $ResultFile -Encoding UTF8
  }
  if ($ShowResult) {
    # The box runs in its own process so this script exits now: the desktop app waits for it,
    # and its menu says "Updating" until then. ServiceNotification puts the box on top even
    # though nothing here has a visible window.
    $kind = if ($ok) { "Information" } else { "Warning" }
    $text = $message.Replace("'", "''")
    $show = "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('$text', 'Update Mea', 'OK', '$kind', 'Button1', 'ServiceNotification')"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($show))
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -EncodedCommand $encoded"
  }
  Pop-Location
  exit $(if ($ok) { 0 } else { 1 })
}

# Local edits and new files that already match $ref byte for byte (work that reached GitHub through
# a PR but was also left in this folder) would block the switch or pull for nothing. Put those back
# or remove them, since $ref brings the same content. Anything that differs stays and still blocks.
function Clear-AlreadyUpstream([string]$ref) {
  $edited = @(& $git diff --name-only HEAD 2>$null)
  $added = @(& $git ls-files --others --exclude-standard 2>$null)
  foreach ($file in $edited + $added) {
    if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $theirs = (& $git rev-parse --verify --quiet "${ref}:$file" 2>$null | Select-Object -First 1)
    if (-not $theirs) { continue }
    $mine = (& $git hash-object -- $file 2>$null | Select-Object -First 1)
    if ($mine -ne $theirs) { continue }
    if ($edited -contains $file) { & $git checkout HEAD -- $file 2>$null | Out-Null }
    else { Remove-Item -LiteralPath $file -Force }
    Write-Log "$file already matches $ref; cleared the local copy so the update can go ahead."
  }
}

function Test-MeaUp {
  try { return [bool](Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 3).ok } catch { return $false }
}

# A hidden window can't answer a password prompt; fail instead of waiting forever.
$env:GIT_TERMINAL_PROMPT = "0"

Push-Location $root
Write-Log "Updating Mea in $root"

$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { Finish $false $false "Git isn't installed or isn't on PATH, so Mea can't fetch updates." }
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun -and (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe")) { $bun = "$env:USERPROFILE\.bun\bin\bun.exe" }
if (-not $bun) { Finish $false $false "Bun isn't installed or isn't on PATH, so Mea can't be rebuilt." }

$branch = (& $git rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
$before = (& $git rev-parse HEAD 2>$null | Select-Object -First 1)
if (-not $before) { Finish $false $false "$root isn't a Git checkout, so it can't be updated this way." }

# 1. Get the new code. Updates come from main: when the folder sits on another branch that main
# already contains (a merged feature branch), switch back to main first, or the pull below would only
# fetch that branch and nothing merged since. A branch with work main doesn't have yet stays put.
$mainBranch = "main"
$fromBranch = $null
if ($branch -ne $mainBranch) {
  Invoke-Logged $git @("fetch", "origin") | Out-Null
  if ($LASTEXITCODE -ne 0) { Finish $false $false "Couldn't reach GitHub to check for updates. Mea is still running as before." }
  & $git merge-base --is-ancestor HEAD "origin/$mainBranch" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Log "$branch is already in $mainBranch; switching to $mainBranch to update."
    Clear-AlreadyUpstream "origin/$mainBranch"
    $switch = Invoke-Logged $git @("switch", $mainBranch)
    if ($LASTEXITCODE -ne 0) {
      $why = if ($switch -match "overwritten") { "files edited in Mea's folder would be overwritten (the list is in update.log)" } else { "git switch exited with $LASTEXITCODE" }
      Finish $false $false "Couldn't switch from $branch to ${mainBranch}: $why. Mea is still running as before."
    }
    $fromBranch = $branch
    $branch = $mainBranch
  } else {
    Write-Log "$branch has commits that aren't in $mainBranch yet, so this updates $branch only."
  }
}

if ($branch -eq $mainBranch -and -not $fromBranch) {
  Invoke-Logged $git @("fetch", "origin") | Out-Null
  if ($LASTEXITCODE -ne 0) { Finish $false $false "Couldn't reach GitHub to check for updates. Mea is still running as before." }
}
Clear-AlreadyUpstream "@{u}"

# --ff-only never merges or overwrites your own changes; it refuses instead.
$pull = Invoke-Logged $git @("pull", "--ff-only")
if ($LASTEXITCODE -ne 0) {
  $lines = @($pull | Where-Object { $_.Trim() })
  $why = ($lines | Where-Object { $_ -match "error|fatal|overwritten|diverge|not possible|no tracking" } | Select-Object -First 1)
  if (-not $why -and $lines.Count) { $why = $lines[-1] }
  if (-not $why) { $why = "git pull exited with $LASTEXITCODE." }
  $why = $why.Trim().TrimEnd(":")
  if ($pull -match "local changes") { $why = "files edited in Mea's folder would be overwritten (the list is in update.log)" }
  elseif ($pull -match "diverge|not possible to fast-forward") { $why = "Mea's folder has its own commits that aren't on GitHub" }
  if ($fromBranch) { Invoke-Logged $git @("switch", $fromBranch) | Out-Null }
  Finish $false $false "Couldn't update: $why. Mea is still running as before."
}
$after = (& $git rev-parse HEAD 2>$null | Select-Object -First 1)
if ($after -eq $before) {
  Write-Log "Nothing new to pull; rebuilding $branch at $($after.Substring(0, 7)) anyway."
}
$count = (& $git rev-list --count "$before..$after" 2>$null | Select-Object -First 1)
$subject = (& $git log -1 --format=%s 2>$null | Select-Object -First 1)

# The task runs either Bun with the source, or dist\mea.exe (install-service.ps1 -Exe).
$exeMode = $false
try {
  $action = (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).Actions | Select-Object -First 1
  $exeMode = [bool]($action.Execute -like "*mea.exe")
} catch {
  Write-Log "Couldn't read the '$TaskName' task ($($_.Exception.Message)); assuming it runs Bun."
}

function Undo-Pull([string]$what) {
  # Puts the code back to the version that's running, keeping any local edits, so the next update retries.
  if ($fromBranch) { Invoke-Logged $git @("switch", $fromBranch) | Out-Null }
  else { Invoke-Logged $git @("reset", "--keep", $before) | Out-Null }
  if ($after -eq $before) { Finish $false $false "The rebuild failed at $what, so Mea keeps running the build it had. Details are in update.log." }
  Finish $false $false "The update downloaded but $what failed, so Mea stays on the previous version. Details are in update.log."
}

function Restart-Mea {
  Invoke-Logged "schtasks.exe" @("/End", "/TN", $TaskName) | Out-Null
  Start-Sleep -Seconds 2
  Invoke-Logged "schtasks.exe" @("/Run", "/TN", $TaskName) | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# 2. Packages and build. The web build happens while Mea runs, so it's only down for the restart.
# Packages only need installing when the lockfile differs from the one last installed. Comparing against
# a stamp (not this pull's diff) also catches code that arrived by some other git pull.
$lockFile = @("bun.lock", "bun.lockb") | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
$lockHash = if ($lockFile) { (Get-FileHash $lockFile -Algorithm SHA256).Hash } else { "" }
$stamp = Join-Path $root "node_modules\.mea-installed-lock"
$installedHash = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
if ($Force -or -not $lockHash -or $lockHash -ne $installedHash) {
  Invoke-Logged $bun @("install", "--frozen-lockfile") | Out-Null
  if ($LASTEXITCODE -ne 0) { Undo-Pull "installing packages" }
  if ($lockHash) { Set-Content -Path $stamp -Value $lockHash -NoNewline }
} else {
  Write-Log "Packages unchanged; skipping bun install."
}

if ($exeMode) {
  # mea.exe can't be replaced while it runs, so stop it first.
  Invoke-Logged "schtasks.exe" @("/End", "/TN", $TaskName) | Out-Null
  Start-Sleep -Seconds 2
  Invoke-Logged $bun @("scripts/build-exe.ts", "--hide-console") | Out-Null
  $built = ($LASTEXITCODE -eq 0)
  Invoke-Logged "schtasks.exe" @("/Run", "/TN", $TaskName) | Out-Null
  $restarted = ($LASTEXITCODE -eq 0)
  if (-not $built) { Undo-Pull "building mea.exe" }
} else {
  Invoke-Logged $bun @("run", "build") | Out-Null
  if ($LASTEXITCODE -ne 0) { Undo-Pull "the build" }
  $restarted = Restart-Mea
}

$version = "$($after.Substring(0, 7)): $subject"
if (-not $restarted) {
  Finish $false $true "Updated to $version, but couldn't restart the '$TaskName' task. Use Restart in the tray, or Task Scheduler."
}

# 3. Wait for Mea to come back.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and -not (Test-MeaUp)) { Start-Sleep -Seconds 1 }
if (-not (Test-MeaUp)) {
  Finish $false $true "Updated to $version, but Mea didn't answer within a minute of restarting. Check the logs."
}
$changes = if ($count -eq "0") { "nothing new to pull" } elseif ($count -eq "1") { "1 new change" } else { "$count new changes" }
if ($fromBranch) { $changes += ", back on $mainBranch from $fromBranch" }
Finish $true $true "Mea is rebuilt ($changes) and running again. Now on $version. Refresh Mea's page to see it."
