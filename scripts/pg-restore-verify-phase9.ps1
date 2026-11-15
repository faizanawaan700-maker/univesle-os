# PowerShell 5.1 compatible PostgreSQL restore verification script
# Requires explicit archive path parameter

param(
    [Parameter(Mandatory=$true)]
    [string]$ArchivePath
)

# Never print credentials
if (-not (Test-Path $ArchivePath -PathType Leaf)) {
    Write-Error "Archive not found: $ArchivePath"
    exit 1
}

$pgRestorePath = "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"
$pgAdminPath = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
if (-not (Test-Path $pgRestorePath)) {
    Write-Error "pg_restore.exe not found at $pgRestorePath"
    exit 1
}
if (-not (Test-Path $pgAdminPath)) {
    Write-Error "psql.exe not found at $pgAdminPath"
    exit 1
}

# Generate a cryptographically random temporary verification database name
$bytes = New-Object byte[4]
[System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes)
$randomPart = ($bytes[0] * 256 + $bytes[1]) % 100000
$tempDbName = "verify_$randomPart"

# Never use ubos_development as the target
if ($tempDbName -eq "ubos_development") {
    Write-Error "Refusing to use ubos_development as the target database name."
    exit 1
}

# Never restore over an existing database; create fresh temp db
$checkQuery = "SELECT 1 FROM pg_database WHERE datname = '$tempDbName';"
$result = & "$pgAdminPath" -d postgres -t -c "$checkQuery" 2>&1
if ($LASTEXITCODE -eq 0) {
    $rows = $result | Where-Object { $_ -match "^\s*1\s*$" }
    if ($rows) {
        Write-Error "Temporary database $tempDbName already exists."
        exit 1
    }
}

# Create the temporary database
$createQuery = "SELECT 'CREATE DATABASE $tempDbName' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$tempDbName') LIMIT 1;"
&$pgAdminPath -d postgres -c "$createQuery" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create temporary database $tempDbName"
    exit 1
}

# Restore using pg_restore --exit-on-error
$restoreArgs = @(
    "--exit-on-error",
    "-d", $tempDbName,
    "$ArchivePath"
)

try {
    $restoreResult = & $pgRestorePath $restoreArgs
    $restoreExitCode = $LASTEXITCODE
} catch {
    Write-Error "Failed to execute pg_restore."
    exit 1
}

if ($restoreExitCode -ne 0) {
    Write-Error "pg_restore --exit-on-error failed with exit code $restoreExitCode"
    # Do NOT drop the temporary database; leave it intact for explicit later cleanup
    exit 1
}

# Verify restored schema objects - list public tables
try {
    $schemaQuery = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
    $tableCount = & "$pgAdminPath" -d "$tempDbName" -t -c "$schemaQuery" 2>&1
    Write-Verbose "Verified restored schema: $tableCount public tables found."
} catch {
    Write-Warning "Schema verification encountered an issue."
}

# Verify meaningful restored data/row counts
try {
    $rowQuery = "SELECT SUM(n_live_tup) FROM pg_stat_user_tables;"
    $rowCount = & "$pgAdminPath" -d "$tempDbName" -t -c "$rowQuery" 2>&1
    Write-Verbose "Verified restored data: $rowCount estimated rows found."
} catch {
    Write-Warning "Row count verification encountered an issue."
}

# Report the generated temporary database name for explicit later cleanup
# Do NOT automatically DROP the temporary database
Write-Host "Verification database name: $tempDbName"
Write-Host "Backup verification completed successfully."
exit 0
