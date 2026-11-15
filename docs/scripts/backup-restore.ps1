<#
.SYNOPSIS
  Backup and verify-restore for UBOS PostgreSQL, without touching production.

.DESCRIPTION
  `backup`  writes a custom-format dump to the chosen directory.
  `verify`  restores the newest dump into a SCRATCH database and reconciles
            row counts plus invoice totals against the source. The scratch
            database is dropped afterwards unless -KeepScratch is supplied.

  Safety:
  - Refuses to run when PGDATABASE looks like a production name unless
    -AllowNamedProduction is explicitly passed.
  - Never drops or truncates the source database.
  - The restore target is always `<database>_restore_check`.

.EXAMPLE
  $env:PGPASSWORD = '<secret>'
  .\docs\scripts\backup-restore.ps1 -Mode backup -Database ubos_development
  .\docs\scripts\backup-restore.ps1 -Mode verify -Database ubos_development
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("backup", "verify")]
  [string]$Mode,

  [string]$Database = "ubos_development",
  [string]$HostName = "127.0.0.1",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$OutputDirectory = ".\backups",
  # Optional explicit archive for -Mode verify. Without it the newest file named
  # `ubos-<database>-*.dump` is used; passing -DumpFile also allows drilling an
  # archive produced by another tool (for example `backup_<database>_<stamp>.backup`).
  [string]$DumpFile,
  [switch]$KeepScratch,
  [switch]$AllowNamedProduction
)

$ErrorActionPreference = "Stop"

# Use the PostgreSQL client tools from the standard Windows install when they are
# not already on PATH, so the script works from a plain shell.
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  $candidate = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { $env:Path = "$($candidate.DirectoryName);$env:Path" }
}
foreach ($tool in @("pg_dump", "pg_restore", "psql")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool was not found. Install PostgreSQL client tools or add them to PATH."
  }
}

$productionNames = @("production", "prod", "live", "main")
if (($productionNames -contains $Database.ToLowerInvariant()) -and -not $AllowNamedProduction) {
  throw "Refusing to operate on '$Database': it looks like a production database. Pass -AllowNamedProduction only with explicit approval."
}

$script:SqlFile = Join-Path ([System.IO.Path]::GetTempPath()) ("ubos-sql-{0}.sql" -f ([guid]::NewGuid()))

# SQL is passed through a temporary file: Windows PowerShell strips the double
# quotes that PostgreSQL needs for case-sensitive identifiers when SQL is passed
# as an inline argument.
function Invoke-Psql([string]$target, [string]$sql) {
  Set-Content -Path $script:SqlFile -Value $sql -Encoding ASCII
  $output = & psql --host $HostName --port $Port --username $User --dbname $target --no-psqlrc --tuples-only --no-align --file $script:SqlFile
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $target : $sql" }
  return ($output | Where-Object { $_ -ne "" } | Select-Object -First 1)
}

function Get-Fingerprint([string]$target) {
  [pscustomobject]@{
    Database       = $target
    Organizations  = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "Organization"')
    Users          = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "User"')
    Sales          = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "Sale"')
    Payments       = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "Payment"')
    StockMovements = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "StockMovement"')
    SalesTotal     = (Invoke-Psql $target 'SELECT COALESCE(SUM("total"), 0)::text FROM "Sale"')
    Migrations     = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
    Journals       = [int](Invoke-Psql $target 'SELECT COUNT(*) FROM "JournalEntry"')
    JournalDebits  = (Invoke-Psql $target 'SELECT COALESCE(SUM("debit"), 0)::text FROM "JournalEntryLine"')
    JournalCredits = (Invoke-Psql $target 'SELECT COALESCE(SUM("credit"), 0)::text FROM "JournalEntryLine"')
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if ($Mode -eq "backup") {
  $file = Join-Path $OutputDirectory ("ubos-{0}-{1}.dump" -f $Database, (Get-Date -Format "yyyyMMdd-HHmmss"))
  & pg_dump --host $HostName --port $Port --username $User --format=custom --compress=9 --file $file $Database
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
  $size = (Get-Item $file).Length
  Write-Output ("backup ok: {0} ({1:N0} bytes)" -f $file, $size)
  return
}

# Mode = verify
if ($DumpFile) {
  if (-not (Test-Path -LiteralPath $DumpFile)) { throw "Dump file not found: $DumpFile" }
  $dump = Get-Item -LiteralPath $DumpFile
} else {
  $dump = Get-ChildItem -Path $OutputDirectory -File |
    Where-Object { $_.Name -like ("ubos-{0}-*.dump" -f $Database) -or $_.Name -like ("backup_{0}_*.backup" -f $Database) } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $dump) { throw "No dump found in $OutputDirectory for $Database. Run -Mode backup first or pass -DumpFile." }
Write-Output ("verifying archive: {0} ({1:N0} bytes, written {2:o})" -f $dump.FullName, $dump.Length, $dump.LastWriteTime)

$scratch = "${Database}_restore_check"
Write-Output "source fingerprint:"
$source = Get-Fingerprint $Database
$source | Format-List | Out-String | Write-Output

$exists = Invoke-Psql "postgres" "SELECT 1 FROM pg_database WHERE datname = '$scratch'"
if ($exists -eq "1") {
  if ($KeepScratch) { throw "Scratch database $scratch already exists. Drop it before running a drill." }
  [void](Invoke-Psql "postgres" "DROP DATABASE ""$scratch""")
}
[void](Invoke-Psql "postgres" "CREATE DATABASE ""$scratch""")

& pg_restore --host $HostName --port $Port --username $User --dbname $scratch --no-owner --no-privileges $dump.FullName
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }

Write-Output "restored fingerprint:"
$restored = Get-Fingerprint $scratch
$restored | Format-List | Out-String | Write-Output

$failures = @()
foreach ($field in @("Organizations", "Users", "Sales", "Payments", "StockMovements", "SalesTotal", "Migrations", "Journals", "JournalDebits", "JournalCredits")) {
  if ($source.$field -ne $restored.$field) {
    $failures += "$field differs: source=$($source.$field) restored=$($restored.$field)"
  }
}

if (-not $KeepScratch) {
  [void](Invoke-Psql "postgres" "DROP DATABASE ""$scratch""")
  Write-Output "scratch database $scratch dropped"
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Error $_ }
  throw "Restore verification FAILED ($($failures.Count) mismatches)."
}
Write-Output "restore verification PASSED: all reconciled values match the source."
