# Desktop launcher for Nexus that always runs the latest source tree.
#
# The NSIS-installed exe bundles a frozen renderer from whichever commit
# was last packaged — changes landed in git afterwards never reach it.
# This script replaces that shortcut with a "build-then-run" flow so that
# double-clicking the icon always picks up the latest commit.
#
# Trade-off: adds ~15-30 s of `tsc -b && vite build` on every launch.
# Skip this script and keep the NSIS shortcut when you want fast cold
# start from a known-stable packaged build.

$ErrorActionPreference = 'Stop'

# Force UTF-8 on both ends so [SherpaKWS] wakeWord: '星绘' prints correctly
# instead of the cp936 mojibake '鏄熺粯'. The electron main process writes
# UTF-8 bytes; Windows PowerShell by default interprets console output as
# the system ANSI code page.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$ProjectRoot = 'F:\nexus'
Set-Location -Path $ProjectRoot

Write-Host '[Nexus launcher] Building renderer + main...' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host '[Nexus launcher] Build failed — aborting launch.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit $LASTEXITCODE
}

Write-Host '[Nexus launcher] Starting electron...' -ForegroundColor Cyan
npx electron .
