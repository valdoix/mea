<#
  Removes the Mea background service. Your data in .\data is left untouched.
  Run from an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1
#>
param([string]$TaskName = "Mea")
$ErrorActionPreference = "Stop"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Mea's service was removed. Your stories are still in the data folder." -ForegroundColor Green
} else {
  Write-Host "No '$TaskName' task found."
}
# ARCH-09: the tray icon's sign-in shortcut, if -Tray put one there.
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Mea tray.lnk"
if (Test-Path $lnk) {
  Remove-Item $lnk
  Write-Host "The tray icon won't start at sign-in any more (close it from its menu: Hide this icon)."
}
