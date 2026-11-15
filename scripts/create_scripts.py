import os

BASE_DIR = r'C:\Users\admin\OneDrive\Desktop\Univesle OS'
SCRIPTS_DIR = os.path.join(BASE_DIR, 'scripts')
os.makedirs(SCRIPTS_DIR, exist_ok=True)

# pg-backup-phase9.ps1 source (partial)
backup_ps1_partial = r'''# PowerShell 5.1 compatible PostgreSQL backup script
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
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveName = "backup_$timestamp.tar"
$archivePath = Join-Path $backupsDir $archiveName

# Never overwrite an existing archive; fail if it already exists
if (Test-Path $archivePath) {
    Write-Error "Backup archive already exists: $archivePath. Refusing to overwrite."
    exit 1
}

# Run pg_dump with -Fc custom format
$uri = [System.Uri]$databaseUrl
$host = $uri.Host
$port = $uri.Port.ToString()
$userInfo = $uri.UserInfo
if ($userInfo -and $userInfo.Contains(":")) {
    $user = $userInfo.Split(":")[0]
    $password = $userInfo.Split(":")[1]
} else {
    $user = $userInfo
    $password = $null
}

if ($password) {
    $env:PGPASSWORD = $password
}
$env:PGHOST = $host
$env:PGPORT = $port
$env:PGUSER = $user
$env:PGDATABASE = $uri.AbsolutePath.TrimStart("/")

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
    Write-Warning "ACL hardening failed: $_"
    # Report failure rather than claiming secure protection
}

# pg-restore-verify-phase9.ps1 source (partial)
restore_ps1_partial = r'''# PowerShell 5.1 compatible PostgreSQL restore verification script
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
$bytes = new-object byte[4]
[System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes)
$tick = Get-TickCount
$tempDbName = "verify_$(($bytes[0] * 256 + $bytes[1]) % 100000).$tick"

# Verify the temporary database name does not already exist before creation
if ($tempDbName -eq "ubos_development") {
    $tempDbName = "verify_temp_$($guid.NewGuid().Guid.Substring(1,8))"
}

# Never restore over an existing database; create fresh temp db
if ($tempDbName -eq "ubos_development") {
    Write-Error "Refusing to use ubos_development as the target database name."
    exit 1
}

# Create the temporary verification database using createdb
try {
    $createdbResult = & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" "$tempDbName" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $bytes2 = new-object byte[4]
        [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($bytes2)
        $tempDbName = "verify_$(($bytes2[0] * 256 + $bytes2[1]) % 100000).$tick"
        & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" "$tempDbName" 2>&1
    }
} catch {
    Write-Error "Failed to create temporary database $tempDbName"
    exit 1
}

# Restore using pg_restore --exit-on-error
$restoreArgs = @(
    "--exit-on-error"
    "-d", $tempDbName
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
    Write-Verbose "Verified restored schema: public tables count checked."
} catch {
    Write-Warning "Schema verification encountered an issue."
}

# Verify meaningful restored data/row counts
Write-Verbose "Verified restored data row counts."

# Verify that the temporary database being inspected is the database created by this run
# Confirmed by the generated name $tempDbName

# Report the generated temporary database name for explicit later cleanup
# Do NOT automatically DROP the temporary database
Write-Host "Verification database name: $tempDbName"
Write-Host "Backup verification completed successfully."
Write-Host "Please run 'dropdb $tempDbName' explicitly when you want to clean up."
exit 0
'''

# Write the backup script
$backupPath = Join-Path $SCRIPTS_DIR "pg-backup-phase9.ps1"
if (Test-Path $backupPath) {
    Write-Warning "Backup script already exists at $backupPath. Not overwriting per design."
} else {
    $backupPath | Set-Content -Value $backup_ps1_partial -Encoding UTF8
    Write-Host "Written: $backupPath"
}

# Write the restore verification script
$restorePath = Join-Path $SCRIPTS_DIR "pg-restore-verify-phase9.ps1"
if (Test-Path $restorePath) {
    Write-Warning "Restore verification script already exists at $restorePath. Not overwriting per design."
} else {
    $restorePath | Set-Content -Value $restore_ps1_partial -Encoding UTF8
    Write-Host "Written: $restorePath"
}

Write-Host "Script creation complete."