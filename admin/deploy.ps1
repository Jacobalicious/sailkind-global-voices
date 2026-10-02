# Builds the review page and uploads it to Google, updating the live link in place.
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File "C:\Projects\Side Quest\SailKind Global Voices\admin\deploy.ps1"
# (Windows blocks .ps1 files by default; -ExecutionPolicy Bypass allows this one
#  run without changing anything on the machine.)
$ErrorActionPreference = "Stop"
$deployment = "AKfycbxgYmsK8QYyTzz-nTtpU7Gz2BjsDsu4HUTm7-u8DSAd19uo7CUJgLDNO4ES1JaR6Uy8fg"
Set-Location $PSScriptRoot
node build.mjs
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# npm's global folder isn't always on PowerShell's PATH, so find clasp ourselves.
$clasp = (Get-Command clasp.cmd -ErrorAction SilentlyContinue).Source
if (-not $clasp) { $clasp = Join-Path $env:APPDATA "npm\clasp.cmd" }
if (-not (Test-Path $clasp)) {
  throw "Couldn't find clasp. Install it with: npm install -g @google/clasp"
}

& $clasp push --force
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }
& $clasp update-deployment $deployment --description "Review page"
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }
Write-Output "Review page updated."
