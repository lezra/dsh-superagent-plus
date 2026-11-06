#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Diagnoses why DSH Desktop may not show dsh-superagent-plus, and prints the next action.
.DESCRIPTION
  DSH Desktop owns its own profile and loads the bundles named in that profile's package.json. This script checks every
  step that has to hold before the Superagent sidebar entry appears: the bundle is listed, the installed package is the file
  this checkout built, the Desktop application was started after the bundle was installed, and the plugin's state directory
  shows that a runtime has loaded it. It changes nothing.
.EXAMPLE
  pwsh scripts/desktop-doctor.ps1
#>
$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profile = Join-Path $dshHome 'profiles/desktop'
$packageFile = Join-Path $profile 'package.json'
$installed = Join-Path $profile 'node_modules/dsh-superagent-plus'
$stateDir = Join-Path $dshHome 'state/dsh-superagent-plus'
$problems = 0
function Ok($text) { Write-Host "  ok    $text" -ForegroundColor Green }
function Bad($text) { Write-Host "  FAIL  $text" -ForegroundColor Red; $script:problems++ }
function Note($text) { Write-Host "        $text" -ForegroundColor DarkGray }

Write-Host "DSH Desktop profile: $profile"

# 1. The profile lists the bundle and its dependency.
if (-not (Test-Path $packageFile)) {
  Bad "the Desktop profile's package.json is missing; start DSH Desktop once so it creates the profile"
} else {
  $package = Get-Content $packageFile -Raw | ConvertFrom-Json
  $dependency = $package.dependencies.'dsh-superagent-plus'
  $bundles = @($package.dsh.profile.bundles)
  if ($dependency) { Ok "dependency dsh-superagent-plus = $dependency" } else { Bad "package.json has no dsh-superagent-plus dependency; install the .tgz through 插件 → 添加插件" }
  if ($bundles -contains 'dsh-superagent-plus') { Ok 'bundle list includes dsh-superagent-plus' }
  else { Bad 'dsh.profile.bundles does not include dsh-superagent-plus; the package is installed but never loaded' }
}

# 2. The installed package is complete and is the build that was packed. An mtime proves nothing here: pnpm copies the
# timestamps out of the tarball, so an installed file can look years old, and only the content can be compared.
$build = Join-Path (Split-Path $PSScriptRoot -Parent) 'lib/index.js'
$installedIndex = Join-Path $installed 'lib/index.js'
if (-not (Test-Path $installedIndex)) {
  Bad "node_modules/dsh-superagent-plus is missing or incomplete; run the pnpm install from docs/009-install.md"
} else {
  $manifest = Get-Content (Join-Path $installed 'package.json') -Raw | ConvertFrom-Json
  if (Test-Path $build) {
    $installedHash = (Get-FileHash $installedIndex -Algorithm MD5).Hash
    $builtHash = (Get-FileHash $build -Algorithm MD5).Hash
    if ($installedHash -eq $builtHash) { Ok ("installed dsh-superagent-plus {0}, its lib/index.js is this checkout's build" -f $manifest.version) }
    else { Bad ("installed dsh-superagent-plus {0}, but its lib/index.js differs from $build - install the tarball of the current build" -f $manifest.version) }
  } else {
    Ok ("installed dsh-superagent-plus {0} (no lib/index.js in this checkout to compare it with)" -f $manifest.version)
  }
  $patch = Join-Path $installed 'cordis.patch.yml'
  if (Test-Path $patch) { Ok 'its cordis.patch.yml is present (the bundle layer that inserts the plugins)' }
  else { Bad 'cordis.patch.yml is missing from the installed package; reinstall it' }
}

# 3. The Desktop application must have started after the bundle was written, because bundles load at startup. The package
# directory carries that moment; the files inside it carry the timestamps packed into the tarball, which can be hours old.
$desktop = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1
if (-not $desktop) {
  Note 'DSH Desktop is not running; start it and look for Superagent in the sidebar'
} elseif (Test-Path $installed) {
  $written = (Get-Item $installed).LastWriteTime
  if ($desktop.StartTime -ge $written) { Ok ("Desktop started {0:yyyy-MM-dd HH:mm}, after the install {1:yyyy-MM-dd HH:mm} - the bundle was loaded" -f $desktop.StartTime, $written) }
  else { Bad ("Desktop started {0:yyyy-MM-dd HH:mm}, before the install {1:yyyy-MM-dd HH:mm} - restart DSH Desktop" -f $desktop.StartTime, $written) }
}

# 4. A runtime that loaded the plugin writes its state directory next to the deployment's records.
if (Test-Path $stateDir) {
  $newest = Get-ChildItem $stateDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) { Ok ("state directory present, newest file {0:yyyy-MM-dd HH:mm} ({1})" -f $newest.LastWriteTime, $newest.Name) }
  else { Note "state directory exists but is empty: the plugin loaded and has not written records yet" }
} else {
  Note "no state directory yet at $stateDir - expected until the Desktop runtime loads the plugin"
}

Write-Host ''
if ($problems -eq 0) {
  Write-Host 'Installed correctly. Restart DSH Desktop, then open Superagent in the sidebar; the first run asks for a Source.' -ForegroundColor Green
} else {
  Write-Host "$problems check(s) failed; fix them in the order printed above, then restart DSH Desktop." -ForegroundColor Yellow
}
exit $(if ($problems -eq 0) { 0 } else { 1 })
