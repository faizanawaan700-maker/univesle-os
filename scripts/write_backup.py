#!/usr/bin/env python3
import os

backup = r"""# PowerShell 5.1 compatible PostgreSQL backup script
# Read DATABASE_URL from env; never print or log credentials

$databaseUrl = $env:DATABASE_URL

if (-not $databaseUrl) {
    Write-Error "DATABASE_URL environment variable is not set."
    exit 1
}

$pgDumpPath = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
$pgRestorePath = "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"

if (-not (Test-Path $pgDumpPath)) {
    Write-Error "pg_dump.exe not found at $pgDumpPath"
    exit 1
}

$backupsDir = Join-Path (Get-Location -PSProvider FileSystem) "backups"
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveName = "backup_$timestamp.backup"
$archivePath = Join-Path $backupsDir $archiveName

if (Test-Path $archivePath) {
    Write-Error "Backup archive already exists: $archivePath. Refusing to overwrite."
    exit 1
}

$uri = [System.Uri]$databaseUrl
$host = $uri.Host
$port = $uri.Port.ToString()
$databasePath = $uri.AbsolutePath.TrimStart("/")

if ($port -ne "5432") {
    $env:PGPORT = $port
}
$env:PGHOST = $host
$env:PGDATABASE = $databasePath

$dumpArgs = @("-Fc")

try {
    $dumpProc = Start-Process -FilePath $pgDumpPath -ArgumentList $dumpArgs -NoNewWindow -RedirectStandardOutput $null -RedirectStandardError $null -Wait -PassThru
    $dumpExitCode = $dumpProc.ExitCode
} catch {
    Write-Error "Failed to execute pg_dump."
    exit 1
}

if ($dumpExitCode -ne 0) {
    Write-Error "pg_dump failed with exit code $dumpExitCode"
    exit 1
}

$restoreArgs = @("-l", $archivePath)
try {
    $restoreProc = Start-Process -FilePath $pgRestorePath -ArgumentList $restoreArgs -NoNewWindow -RedirectStandardOutput $null -RedirectStandardError $null -Wait -PassThru
    $restoreExitCode = $restoreProc.ExitCode
} catch {
    Write-Error "Failed to execute pg_restore for verification."
    exit 1
}

if ($restoreExitCode -ne 0) {
    Write-Error "pg_restore -l verification failed with exit code $restoreExitCode"
    exit 1
}

try {
    $acl = Get-Acl -Path $archivePath
    $acl.SetAccessRuleProtection("Administrator", "SYSTEM")
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "Administrators",
        "FullControl",
        "ContainerInherit, ObjectInherit",
        "NoPropagateInherit",
        "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $archivePath -Acl $acl
} catch {
    Write-Error "ACL hardening failed: $_"
    exit 1
}

Write-Host "Backup completed: $archiveName"
exit 0
"""

# GUARDED: never silently overwrite a verified Phase 9 script.
# Previously this used open(..., "w"), which replaced the 12,014-byte verified
# script with an early 2,657-byte draft. See scripts/guard_helpers.py.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from guard_helpers import safe_write

_target = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "pg-backup-phase9.ps1")
raise SystemExit(safe_write(_target, backup, allow_overwrite="--allow-overwrite" in _sys.argv))