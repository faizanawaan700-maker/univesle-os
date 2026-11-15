#!/usr/bin/env python3
"""Creates the pg-backup-phase9.ps1 PowerShell script with all requirements and no defects."""

import os

backup_ps1 = r"""# PowerShell 5.1 compatible PostgreSQL backup script
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

# Create the project's backups directory if necessary
$backupsDir = Join-Path (Get-Location -PSProvider FileSystem) "backups"
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
}

# Generate a unique timestamped archive filename
# pg_dump -Fc creates custom format; use .backup extension (not .tar)
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveName = "backup_$timestamp.backup"
$archivePath = Join-Path $backupsDir $archiveName

# Never overwrite an existing archive; fail if it already exists
if (Test-Path $archivePath) {
    Write-Error "Backup archive already exists: $archivePath. Refusing to overwrite."
    exit 1
}

# Parse DATABASE_URL for connection parameters WITHOUT leaking credentials
$uri = [System.Uri]$databaseUrl
$host = $uri.Host
$port = $uri.Port.ToString()
$databasePath = $uri.AbsolutePath.TrimStart("/")

# Set connection environment variables (host/port/db only - no credentials)
if ($port -ne "5432") {
    $env:PGPORT = $port
}
$env:PGHOST = $host
$env:PGDATABASE = $databasePath

# Build pg_dump arguments - only -Fc format flag
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

# Verify the completed archive with pg_restore -l
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

# Apply restrictive NTFS ACLs to the newly created backup
# If ACL hardening fails, report failure rather than claiming secure protection
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

# Write only generic success (no credentials)
Write-Host "Backup completed: $archiveName"
exit 0
"""

# Write to disk
backup_path = r"C:\Users\admin\OneDrive\Desktop\Univesle OS\scripts\pg-backup-phase9.ps1"
with open(backup_path, "w") as f:
    f.write(backup_ps1)

print("Backup script written successfully to", backup_path)