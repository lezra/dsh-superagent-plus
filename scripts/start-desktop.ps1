#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Starts DSH Desktop with a clean plugin lock, and warns about extra instances.
.DESCRIPTION
  DSH Desktop keeps one runtime per profile. A forcefully closed window can leave
  state\<deployment>.lock behind, after which the next launch reports that
  dsh-superagent-plus is unresponsive. This script removes that stale lock (only when no
  Desktop host is running), then starts the installed application so the profile loads
  once. It never runs `dsh web`, and it never touches deployment data.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-desktop.ps1
.EXAMPLE
  # Check what it would do without launching anything.
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-desktop.ps1 -NoStart
#>
param(
  [string]$App = '',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$lock = Join-Path $dshHome 'state/dsh-superagent-plus.lock'

$hosts = @(Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'dsh-desktop-host' })
if ($hosts.Count -gt 1) {
  Write-Host "WARNING: $($hosts.Count) Desktop hosts are running. Quit the extra windows first: several hosts share one profile" -ForegroundColor Yellow
  Write-Host '         and start duplicate Feishu consumers, which is what makes the console windows keep flashing.' -ForegroundColor Yellow
}

if (Test-Path $lock) {
  if ($hosts.Count -gt 0) {
    Write-Host "A Desktop host is running, so the lock at $lock is live; it is left alone." -ForegroundColor DarkGray
  } else {
    Remove-Item $lock -Recurse -Force
    Write-Host "Removed the stale lock $lock" -ForegroundColor Green
  }
}

# The running host names its own executable, and installers record where they put it, so a custom install
# directory (the app is not always under Program Files) still resolves.
$installed = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
) | ForEach-Object { Get-ChildItem $_ -ErrorAction SilentlyContinue } | ForEach-Object {
  $entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($entry.DisplayName -notlike 'DeepSeek Harness*') { return }
  if ($entry.InstallLocation) { Join-Path $entry.InstallLocation 'DeepSeek Harness.exe' }
  if ($entry.DisplayIcon -match '^(?:"?)(.+?\.exe)') { $Matches[1] }
}

$candidates = @($App, $env:DSH_DESKTOP_APP)
$candidates += $hosts | ForEach-Object { $_.ExecutablePath }
$candidates += $installed
$candidates += Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
$candidates += Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'
$exe = $candidates | Where-Object { $_ } | Select-Object -Unique | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
  Write-Host 'Could not find "DeepSeek Harness.exe". Pass its path: -App "<path>"' -ForegroundColor Red
  exit 1
}
Write-Host "Desktop application: $exe" -ForegroundColor DarkGray
if ($NoStart) { Write-Host 'NoStart: not launching.'; exit 0 }

# One launch, detached: the window opens and this terminal can be closed.
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
Write-Host 'Started DeepSeek Harness. Keep one window per profile; the Superagent panel loads this profile once.' -ForegroundColor Green
