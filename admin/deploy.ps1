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

# npm's global folder isn't always on PowerShell's PATH, so look for clasp in the
# usual places, and fall back to npx (which rides along with node) if it isn't there.
$tried = @(
  (Get-Command clasp.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  (Join-Path $env:APPDATA "npm\clasp.cmd")
  (Join-Path $env:USERPROFILE "AppData\Roaming\npm\clasp.cmd")
) | Where-Object { $_ }

$clasp = $tried | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($clasp) {
  Write-Output "Using clasp at $clasp"
  $exe = $clasp
  $pre = @()
} else {
  Write-Output "No clasp found. Looked in:"
  $tried | ForEach-Object { Write-Output "  $_" }
  Write-Output "Falling back to npx."
  $exe = "npx"
  $pre = @("--yes", "@google/clasp")
}

$pushArgs = $pre + @("push", "--force")
& $exe @pushArgs
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }

$deployArgs = $pre + @("update-deployment", $deployment, "--description", "Review page")
& $exe @deployArgs
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

Write-Output "Review page updated."
