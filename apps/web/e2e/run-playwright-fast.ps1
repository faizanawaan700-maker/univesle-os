# Restarts only the UBOS web server against the current build, then runs Playwright.
# The API on 127.0.0.1:4000 is reused when it is already serving.
#
# Usage (from apps/web): powershell -NoProfile -ExecutionPolicy Bypass -File e2e\run-playwright-fast.ps1 [playwright args]
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$webDir = Join-Path $root "apps\web"
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm.cmd was not found on PATH." }

function Test-HttpReady([string]$Url) {
  try {
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $true
  }
  catch {
    $status = 0
    if ($_.Exception -and $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return ($status -gt 0 -and $status -lt 500)
  }
}

function Wait-ForUrl([string]$Url, [int]$Seconds = 60) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady $Url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if (-not (Test-HttpReady "http://127.0.0.1:4000/auth/me")) {
  throw "Start the API first: `$env:API_PORT='4000'; `$env:API_HOST='127.0.0.1'; `$env:FRONTEND_ORIGIN='http://127.0.0.1:3000'; npm run start --prefix apps/api"
}

# Stop only the Next.js server so the rebuilt bundle is the one under test.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
Where-Object { $_.CommandLine -match 'next' } |
ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$webProcess = Start-Process -FilePath $npm -ArgumentList "run", "start", "--", "-H", "127.0.0.1" -WorkingDirectory $webDir -PassThru `
  -RedirectStandardOutput (Join-Path $env:TEMP "ubos-pw-web.log") `
  -RedirectStandardError (Join-Path $env:TEMP "ubos-pw-web.err.log")

try {
  if (-not (Wait-ForUrl "http://127.0.0.1:3000" 90)) {
    throw "Web client did not become ready on 127.0.0.1:3000 (see $env:TEMP\ubos-pw-web.err.log)"
  }
  $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"
  Push-Location $webDir
  try {
    & (Join-Path $webDir "node_modules\.bin\playwright.cmd") test @args
    $code = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
  exit $code
}
finally {
  Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $webProcess.Id } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
}
