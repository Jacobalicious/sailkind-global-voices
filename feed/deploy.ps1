# Uploads the public feed to Google, updating the live link in place.
#   powershell -ExecutionPolicy Bypass -File "C:\Projects\Side Quest\SailKind Global Voices\feed\deploy.ps1"
$ErrorActionPreference = "Stop"
$deployment = "AKfycbyqYHfZOxNLl9edukNzoVjrJzDd9DuV6gDSD5ubYa7YrFVIhSov-pdTldVgCqtH7ksB-A"
Set-Location $PSScriptRoot
$clasp = Join-Path $env:APPDATA "npm\clasp.cmd"
& $clasp push --force
if ($LASTEXITCODE -ne 0) { throw "Upload failed" }
& $clasp update-deployment $deployment --description "Public feed"
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }
Write-Output "Feed updated."
