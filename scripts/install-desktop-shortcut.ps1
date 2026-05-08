# Create (or refresh) a desktop shortcut that launches Nexus from the
# source tree without showing a terminal window. Run once; the shortcut
# then survives across code changes.
#
# Usage: right-click this file in File Explorer -> "Run with PowerShell",
# or run in a terminal:
#   powershell -ExecutionPolicy Bypass -File F:\nexus\scripts\install-desktop-shortcut.ps1

$ErrorActionPreference = 'Stop'

$ShortcutPath = Join-Path $env:USERPROFILE 'Desktop\Nexus (latest).lnk'
$LauncherScript = 'F:\nexus\scripts\launch-nexus.ps1'
$HiddenLauncherScript = 'F:\nexus\scripts\launch-nexus-hidden.vbs'
$ProjectRoot = 'F:\nexus'

# Prefer the same icon electron-builder ships with, if it exists; fall
# back to the built electron binary, and finally to the powershell icon.
$IconCandidates = @(
  'F:\nexus\public\nexus.ico',
  'F:\nexus\dist\nexus.ico',
  'F:\nexus\build\icon.ico',
  'F:\nexus\resources\icon.ico',
  'F:\nexus\assets\icon.ico',
  'F:\nexus\public\favicon.ico'
)
$IconLocation = $null
foreach ($candidate in $IconCandidates) {
  if (Test-Path $candidate) {
    $IconLocation = $candidate
    break
  }
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
if (Test-Path $HiddenLauncherScript) {
  $Shortcut.TargetPath = 'wscript.exe'
  $Shortcut.Arguments = "`"$HiddenLauncherScript`""
} else {
  $Shortcut.TargetPath = 'powershell.exe'
  $Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherScript`""
}
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'Launch Nexus from the latest source without a terminal window'
if ($IconLocation) {
  $Shortcut.IconLocation = $IconLocation
}
$Shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath" -ForegroundColor Green
if (Test-Path $HiddenLauncherScript) {
  Write-Host "Launcher: hidden window via $HiddenLauncherScript"
} else {
  Write-Host 'Hidden launcher missing; shortcut falls back to visible PowerShell.'
}
if ($IconLocation) {
  Write-Host "Using icon: $IconLocation"
} else {
  Write-Host 'No custom icon found — shortcut will use the PowerShell icon. You can change it via right-click -> Properties -> Change Icon.'
}
