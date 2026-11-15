# One-command UBOS browser acceptance run.
#
# Starts the API on 127.0.0.1:4000 and the Next.js server on 127.0.0.1:3000 and
# waits for both health endpoints. Both servers share the hostname 127.0.0.1, so
# the API's SameSite=Lax session cookie is first-party for the web page and is
# sent with every API call from the app.
#
# Prerequisites: `npm run build --prefix apps/api`.
# Usage (from apps/web): npm run test:e2e [-- extra playwright args]
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$apiDir = Join-Path $root "apps\api"
$webDir = Join-Path $root "apps\web"

function Test-HttpReady([string]$Url) {
  # A 401 from /auth/me is a healthy API; any HTTP response under 500 counts.
  try {
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $true
  } catch {
    $status = 0
    if ($_.Exception -and $_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
    }
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

function Stop-ProcessTree($Process) {
  if (-not $Process) { return }
  Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $Process.Id } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
}

$startedApi = $false
$startedWeb = $false
$apiProcess = $null
$webProcess = $null
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm.cmd was not found on PATH." }

try {
  # The API server must be one this script owns, because it has to be started
  # with API_HOST=127.0.0.1 for the cookie domain to line up with the browser.
  if (-not (Test-HttpReady "http://127.0.0.1:4000/auth/me")) {
    $env:API_PORT = "4000"
    $env:API_HOST = "127.0.0.1"
    $env:FRONTEND_ORIGIN = "http://127.0.0.1:3000"
    $apiProcess = Start-Process -FilePath $npm -ArgumentList "run", "start" -WorkingDirectory $apiDir -PassThru `
      -RedirectStandardOutput (Join-Path $env:TEMP "ubos-e2e-api.log") `
      -RedirectStandardError (Join-Path $env:TEMP "ubos-e2e-api.err.log")
    $startedApi = $true
    if (-not (Wait-ForUrl "http://127.0.0.1:4000/auth/me" 90)) {
      throw "API did not become ready on 127.0.0.1:4000 (see $env:TEMP\ubos-e2e-api.err.log)"
    }
  }

  if (-not (Test-HttpReady "http://127.0.0.1:3000")) {
    # NEXT_PUBLIC_* values are embedded at build time, so the bundle is rebuilt
    # with the loopback API URL before the production server starts.
    $env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:4000"
    Push-Location $webDir
    try {
      & $npm run build
      if ($LASTEXITCODE -ne 0) { throw "Web production build failed." }
    } finally {
      Pop-Location
    }
    $webProcess = Start-Process -FilePath $npm -ArgumentList "run", "start", "--", "-H", "127.0.0.1" -WorkingDirectory $webDir -PassThru `
      -RedirectStandardOutput (Join-Path $env:TEMP "ubos-e2e-web.log") `
      -RedirectStandardError (Join-Path $env:TEMP "ubos-e2e-web.err.log")
    $startedWeb = $true
    if (-not (Wait-ForUrl "http://127.0.0.1:3000" 90)) {
      throw "Web client did not become ready on 127.0.0.1:3000 (see $env:TEMP\ubos-e2e-web.err.log)"
    }
  }

  $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"
  $playwright = Join-Path $webDir "node_modules\.bin\playwright.cmd"
  Push-Location $webDir
  try {
    & $playwright test @args
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  exit $code
} finally {
  if ($startedWeb) { Stop-ProcessTree $webProcess }
  if ($startedApi) { Stop-ProcessTree $apiProcess }
}
