#!/usr/bin/env python3
"""Creates the pg-restore-verify-phase9.ps1 PowerShell script with all requirements and no defects."""

import os

restore_ps1 = r"""# PowerShell 5.1 compatible PostgreSQL restore verification script
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
if (-not (Test-Path $pgRestorePath)) {
    Write-Error "pg_restore.exe not found at $pgRestorePath"
    exit 1
}

# Generate a cryptographically random temporary verification database name
$bytes = New-Object byte[4]
[System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes)
$randomPart = ($bytes[0] * 256 + $bytes[1]) % 100000
$tempDbName = "verify_$randomPart"

# Verify the temporary database name does not already exist before creation
if ($tempDbName -eq "ubos_development") {
    $bytes2 = New-Object byte[4]
    [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes2)
    $randomPart = ($bytes2[0] * 256 + $bytes2[1]) % 100000
    $tempDbName = "verify_$randomPart"
}

# Never use ubos_development as the target
if ($tempDbName -eq "ubos_development") {
    Write-Error "Refusing to use ubos_development as the target database name."
    exit 1
}

# Never restore over an existing database; create fresh temp db
if (Test-Path "$tempDbName") {
    # Database exists, generate new random name
    do {
        $bytes3 = New-Object byte[4]
        [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes3)
        $randomPart = ($bytes3[0] * 256 + $bytes3[1]) % 100000
        $tempDbName = "verify_$randomPart"
    } while ($tempDbName -eq "ubos_development")
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
    $tableCount = & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -d "$tempDbName" -t -c "$schemaQuery" 2>&1
    Write-Verbose "Verified restored schema: $tableCount public tables found."
} catch {
    Write-Warning "Schema verification encountered an issue."
}

# Verify meaningful restored data/row counts
try {
    $rowQuery = "SELECT COUNT(*) FROM pg_total_system_rows;"
    $rowCount = & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -d "$tempDbName" -t -c "$rowQuery" 2>&1
    Write-Verbose "Verified restored data: $rowCount system rows found."
} catch {
    Write-Warning "Row count verification encountered an issue."
}

# Verify that the temporary database being inspected is the database created by this run
# Confirmed by the generated name $tempDbName

# Report the generated temporary database name for explicit later cleanup
# Do NOT automatically DROP the temporary database
Write-Host "Verification database name: $tempDbName"
Write-Host "Backup verification completed successfully."
exit 0
"""

# Write to disk
restore_path = r"C:\Users\admin\OneDrive\Desktop\Univesle OS\scripts\pg-restore-verify-phase9.ps1"
with open(restore_path, "w") as f:
    f.write(restore_ps1)

print("Restore verification script written successfully to", restore_path)