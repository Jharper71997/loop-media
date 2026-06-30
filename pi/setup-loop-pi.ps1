<#
  setup-loop-pi.ps1 — provision a freshly-flashed Raspberry Pi into a Loop
  Network TV kiosk from your Windows PC, in one command.

  Per new Pi the whole job is:
    1. Flash the card in Raspberry Pi Imager (settings are remembered).
    2. Boot the Pi, wait ~1 min for it to join WiFi.
    3. Run:   .\setup-loop-pi.ps1 LM-XXXXX
       (LM-XXXXX = that venue's pairing code)

  It waits for the Pi, copies provision-kiosk.sh up, runs it (kiosk launcher,
  blank cursor, the right GPU mode for the Pi model), disables screen blanking,
  and reboots into the kiosk. You'll be asked for the Pi password once.
#>
param(
  [Parameter(Mandatory = $true)][string]$Code,
  [string]$PiHost = "loop-tv-01.local",
  [string]$User   = "loop",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
  [string]$Base   = "https://loop-network-one.vercel.app"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "provision-kiosk.sh"
$target = "$User@$PiHost"

if (-not (Test-Path $script))  { throw "Missing provision-kiosk.sh next to this script." }
if (-not (Test-Path $KeyPath)) { throw "SSH key not found: $KeyPath" }

Write-Host "==> Loop Pi setup:  $Code  ->  $target" -ForegroundColor Cyan

# 1. Wait for the Pi to come up on the network (it may still be booting).
$ok = $false
for ($i = 1; $i -le 30; $i++) {
  ssh -i $KeyPath -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -o BatchMode=yes $target "echo up" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Write-Host "    waiting for $PiHost to answer ... ($i/30)"
  Start-Sleep -Seconds 5
}
if (-not $ok) { throw "Could not reach $PiHost over SSH. Is the Pi powered on and on WiFi? (try its IP: -PiHost 10.0.0.x)" }

# 2. Copy the provisioning script up.
Write-Host "==> Copying provision-kiosk.sh"
scp -i $KeyPath $script "${target}:/home/$User/provision-kiosk.sh"
if ($LASTEXITCODE -ne 0) { throw "scp failed." }

# 3. Run it (strip any Windows line endings first, just in case).
Write-Host "==> Provisioning the kiosk for $Code"
ssh -i $KeyPath $target "sed -i 's/\r`$//' provision-kiosk.sh; chmod +x provision-kiosk.sh; ./provision-kiosk.sh '$Code' '$Base'"
if ($LASTEXITCODE -ne 0) { throw "provision-kiosk.sh failed on the Pi." }

# 4. Disable screen blanking + reboot into the kiosk (needs the Pi password once).
$sec = Read-Host "Pi sudo password for $User (typed once, not stored)" -AsSecureString
$pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
Write-Host "==> Disabling screen blanking + rebooting"
ssh -i $KeyPath $target "echo '$pw' | sudo -S raspi-config nonint do_blanking 1 2>/dev/null; echo '$pw' | sudo -S systemctl reboot 2>/dev/null; echo '$pw' | sudo -S reboot 2>/dev/null" 2>$null
$pw = $null

Write-Host ""
Write-Host "==> DONE. $PiHost is rebooting into the Loop kiosk for $Code." -ForegroundColor Green
Write-Host "    Give it ~40s, then check the TV: player full-screen, no mouse cursor."
