<#
.SYNOPSIS
  Install the Loop Network kiosk app onto a Fire TV over network ADB.

.DESCRIPTION
  Bench provisioning for a company-owned TV. Unbox it, join it to wifi, turn on
  ADB debugging, read its IP off the About screen, run this. Roughly 30 seconds.

  Downloader (the usual sideload route) hangs forever on "Connecting..." on at
  least some Fire OS builds, so this is the supported install path. See
  tv-app/README.md.

.PARAMETER Ip
  The TV's IP, from Settings > My Fire TV > About > Network.

.PARAMETER Apk
  Optional path to an APK. Defaults to downloading the current release from
  www.loopnetwork.org/app, so a bench machine is never installing a stale build.
  (That URL works fine from a laptop; it is only the TV's Downloader that fails.)

.PARAMETER SkipLaunch
  Install without launching. Default is to launch so the pairing screen appears.

.EXAMPLE
  .\provision-tv.ps1 -Ip 192.168.1.57
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$Apk,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'
$PKG    = 'org.loopnetwork.kiosk'
$APKURL = 'https://www.loopnetwork.org/app'
$target = "${Ip}:5555"

function Say([string]$m, [string]$color = 'Gray') { Write-Host $m -ForegroundColor $color }

# --- locate adb -------------------------------------------------------------
$adb = $null
$onPath = Get-Command adb -ErrorAction SilentlyContinue
if ($onPath) {
  $adb = $onPath.Source
} else {
  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe",
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "C:\platform-tools\adb.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $adb = $c; break } }
}
if (-not $adb) {
  Say "adb not found. Install it with:  winget install Google.PlatformTools" 'Red'
  exit 1
}

# --- get the APK ------------------------------------------------------------
if (-not $Apk) {
  $Apk = Join-Path $env:TEMP 'loop-network-tv.apk'
  Say "Downloading current APK from $APKURL"
  Invoke-WebRequest -Uri $APKURL -OutFile $Apk -UseBasicParsing
}
if (-not (Test-Path $Apk)) { Say "APK not found: $Apk" 'Red'; exit 1 }

$size = (Get-Item $Apk).Length
if ($size -lt 100000) { Say "APK looks truncated ($size bytes). Aborting." 'Red'; exit 1 }
Say ("APK: {0} ({1:N0} bytes)" -f $Apk, $size)

# --- connect ----------------------------------------------------------------
# The wifi link to a wall-mounted TV is often lossy enough that a single connect
# times out while the tenth succeeds. Retry rather than trusting the first answer.
Say "Connecting to $target ..."
$state = $null
for ($i = 1; $i -le 30; $i++) {
  & $adb connect $target | Out-Null
  $line = (& $adb devices) | Where-Object { $_ -match [regex]::Escape($target) }
  if ($line) {
    $state = ($line -split '\s+')[1]
    if ($state -ne 'offline') { Say "  connected on attempt $i (state: $state)"; break }
  }
  Start-Sleep -Seconds 2
}

if (-not $state -or $state -eq 'offline') {
  Say "Could not reach $target." 'Red'
  Say "  - Settings > My Fire TV > Developer options > ADB debugging must be ON" 'Yellow'
  Say "  - If you just turned it on, restart the TV" 'Yellow'
  Say "  - Confirm the IP on Settings > My Fire TV > About > Network" 'Yellow'
  exit 1
}

if ($state -eq 'unauthorized') {
  Say "The TV is showing an 'Allow USB debugging?' prompt." 'Yellow'
  Say "Check 'Always allow from this computer', press OK, then waiting..." 'Yellow'
  for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 2
    & $adb connect $target | Out-Null
    $line = (& $adb devices) | Where-Object { $_ -match [regex]::Escape($target) }
    if ($line) { $state = ($line -split '\s+')[1] }
    if ($state -eq 'device') { break }
  }
}

if ($state -ne 'device') { Say "Device never authorized (state: $state)." 'Red'; exit 1 }

$model = (& $adb -s $target shell getprop ro.product.model).Trim()
$rel   = (& $adb -s $target shell getprop ro.build.version.release).Trim()
Say "Device: $model (Android $rel)"

# --- install ----------------------------------------------------------------
Say "Installing $PKG ..."
$out = & $adb -s $target install -r $Apk
$out | ForEach-Object { Say "  $_" }
# -notmatch on an array returns the non-matching ELEMENTS, which is truthy even
# on a successful install. Test for the presence of a match instead.
if (-not ($out -match 'Success')) { Say "Install failed." 'Red'; exit 1 }

# --- verify -----------------------------------------------------------------
$installed = (& $adb -s $target shell pm list packages) | Where-Object { $_ -match $PKG }
if (-not $installed) { Say "Package not present after install." 'Red'; exit 1 }

$ver = (& $adb -s $target shell dumpsys package $PKG) |
       Where-Object { $_ -match 'versionName' } | Select-Object -First 1
Say ("Installed: {0} {1}" -f $PKG, $ver.Trim()) 'Green'

if (-not $SkipLaunch) {
  # monkey narrates to stderr; silence it so the operator sees only the result.
  & $adb -s $target shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 2>$null | Out-Null
  Say "Launched. The pairing screen should be on the TV." 'Green'
  Say "Enter the pairing code from the Loop Network dashboard." 'Green'
}

& $adb disconnect $target | Out-Null
