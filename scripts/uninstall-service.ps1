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
