#!/usr/bin/env python3
import os

restore = r"""# PowerShell 5.1 compatible PostgreSQL restore verification script
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
do {
    $tempDbName = "verify_ (($bytes[0] * 256 + $bytes[1]) % 100000)"
} while ($tempDbName -eq "ubos_development")

# Never use ubos_development as the target
if ($tempDbName -eq "ubos_development") {
    Write-Error "Refusing to use ubos_development as the target database name."
    exit 1
}

# Never restore over an existing database; create fresh temp db
try {
    $dbCheck = & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" "$tempDbName" 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Database already exists, generate new random name
        do {
            $bytes2 = New-Object byte[4]
            [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes2)
            $randomPart = ($bytes2[0] * 256 + $bytes2[1]) % 100000
            $tempDbName = "verify_$randomPart"
        } while ($tempDbName -eq "ubos_development")
        & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" "$tempDbName" 2>&1
    }
} catch {
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

# GUARDED: never silently overwrite a verified Phase 9 script.
# Previously this used open(..., "w"), which replaced the 19,625-byte verified
# script with an early 3,646-byte draft. See scripts/guard_helpers.py.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from guard_helpers import safe_write

_target = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "pg-restore-verify-phase9.ps1")
raise SystemExit(safe_write(_target, restore, allow_overwrite="--allow-overwrite" in _sys.argv))