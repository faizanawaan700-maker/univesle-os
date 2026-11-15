$ErrorActionPreference = 'Stop'

$workspace = $PSScriptRoot
$envPath = Join-Path $workspace 'packages\database\.env'
$migrationPath = Join-Path $workspace 'packages\database\prisma\migrations\20261106000000_phase2_business_operations\migration.sql'
$schemaPath = Join-Path $workspace 'packages\database\prisma\schema.prisma'
$phase2Tables = @(
    'ProductCategory',
    'Product',
    'Inventory',
    'StockMovement',
    'Customer',
    'Supplier',
    'Sale',
    'SaleItem',
    'PurchaseInvoice',
    'PurchaseInvoiceItem',
    'Payment'
)
function Stop-Diagnostic {
    param([string]$Message)
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    Stop-Diagnostic 'Local packages/database/.env was not found. No database connection was attempted.'
}
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    Stop-Diagnostic 'The Phase 2 migration SQL file was not found. No database connection was attempted.'
}
if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) {
    Stop-Diagnostic 'The Prisma schema file was not found. No database connection was attempted.'
}

$databaseUrlLine = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -First 1
if (-not $databaseUrlLine) {
    Stop-Diagnostic 'DATABASE_URL is missing from the local .env file. No database connection was attempted.'
}

$rawUrl = ($databaseUrlLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim()
if ($rawUrl.Length -ge 2 -and
    (($rawUrl[0] -eq '"' -and $rawUrl[$rawUrl.Length - 1] -eq '"') -or
     ($rawUrl[0] -eq "'" -and $rawUrl[$rawUrl.Length - 1] -eq "'"))) {
    $rawUrl = $rawUrl.Substring(1, $rawUrl.Length - 2)
}

try {
    $uri = [System.Uri]::new($rawUrl)
    $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    $userInfo = $uri.UserInfo
    $separator = $userInfo.IndexOf(':')
    if ($separator -lt 0) {
        throw 'Missing username/password separator.'
    }
    $pgUser = [System.Uri]::UnescapeDataString($userInfo.Substring(0, $separator))
    $pgPassword = [System.Uri]::UnescapeDataString($userInfo.Substring($separator + 1))
} catch {
    Stop-Diagnostic 'DATABASE_URL could not be parsed. Its contents were not displayed. No database connection was attempted.'
}

if (@('postgres', 'postgresql') -notcontains $uri.Scheme) {
    Stop-Diagnostic 'DATABASE_URL must use PostgreSQL. No database connection was attempted.'
}
if ($uri.Host -cne '127.0.0.1') {
    Stop-Diagnostic 'DATABASE_URL host must be exactly 127.0.0.1. No database connection was attempted.'
}
if ($uri.Port -ne 5432) {
    Stop-Diagnostic 'DATABASE_URL port must be exactly 5432. No database connection was attempted.'
}
if ($databaseName -cne 'ubos_development') {
    Stop-Diagnostic 'DATABASE_URL database must be exactly ubos_development. No database connection was attempted.'
}
if ([string]::IsNullOrWhiteSpace($pgUser) -or [string]::IsNullOrEmpty($pgPassword)) {
    Stop-Diagnostic 'DATABASE_URL has an empty username or password. No database connection was attempted.'
}

$psqlCommand = Get-Command 'psql.exe' -ErrorAction SilentlyContinue
if (-not $psqlCommand) {
    $psqlCommand = Get-Command 'psql' -ErrorAction SilentlyContinue
}
if (-not $psqlCommand) {
    Stop-Diagnostic 'psql was not found on PATH. Install/use the PostgreSQL client locally; no database connection was attempted.'
}

$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$schemaText = Get-Content -LiteralPath $schemaPath -Raw
$requiredPhase2PermissionKeys = @(
    'catalog.read', 'catalog.manage',
    'inventory.read', 'inventory.manage',
    'sales.read', 'sales.manage',
    'customers.read', 'customers.manage',
    'procurement.read', 'procurement.manage',
    'payments.manage', 'reports.read'
)
$permissionSeedIssues = @()
$permissionInsertMatch = [regex]::Match(
    $migrationSql,
    "(?is)INSERT\s+INTO\s+""Permission""\s*\(""id"",\s*""key"",\s*""description""\)\s*VALUES(.*?)ON\s+CONFLICT\s*\(""key""\)"
)
$parsedPermissionSeeds = @()
if ($permissionInsertMatch.Success) {
    $permissionInsertBody = $permissionInsertMatch.Groups[1].Value
    $permissionSeedRowCount = [regex]::Matches($permissionInsertBody, '(?m)^[ \t]*\(').Count
    $parsedPermissionSeeds = @(
        [regex]::Matches(
            $permissionInsertBody,
            "(?is)\(\s*gen_random_uuid\(\)::text\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)"
        ) | ForEach-Object {
            [pscustomobject]@{
                permission_key = $_.Groups[1].Value.Replace("''", "'")
                description = $_.Groups[2].Value.Replace("''", "'")
            }
        }
    )
    if ($permissionSeedRowCount -ne $requiredPhase2PermissionKeys.Count -or
        $parsedPermissionSeeds.Count -ne $permissionSeedRowCount) {
        $permissionSeedIssues += 'Permission INSERT row count or explicit-ID/description parsing did not match the required seed rows.'
    }
} else {
    $permissionSeedIssues += 'Phase 2 Permission INSERT could not be parsed.'
}

$permissionSeedValues = @()
foreach ($permissionKey in $requiredPhase2PermissionKeys) {
    $matchingSeed = @($parsedPermissionSeeds | Where-Object { $_.permission_key -ceq $permissionKey })
    if ($matchingSeed.Count -ne 1) {
        $permissionSeedIssues += "Expected exactly one migration Permission seed for $permissionKey; found $($matchingSeed.Count)."
        $permissionSeedValues += "('$permissionKey', NULL::text)"
    } else {
        $escapedDescription = $matchingSeed[0].description.Replace("'", "''")
        $permissionSeedValues += "('$permissionKey', '$escapedDescription')"
    }
}
$unexpectedSeedKeys = @(
    $parsedPermissionSeeds |
    Where-Object { $requiredPhase2PermissionKeys -cnotcontains $_.permission_key } |
    ForEach-Object { $_.permission_key }
)
if ($unexpectedSeedKeys.Count) {
    $permissionSeedIssues += 'Migration Permission INSERT contains unexpected permission keys: ' + ($unexpectedSeedKeys -join ', ')
}
$permissionSeedValuesSql = $permissionSeedValues -join ",`n      "
$permissionSeedKeysSql = @($requiredPhase2PermissionKeys | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ','
$expectedMigrationTables = @(
    [regex]::Matches($migrationSql, '(?im)^\s*CREATE\s+TABLE\s+"([^"]+)"') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
)
$expectedIndexes = @(
    [regex]::Matches(
        $migrationSql,
        '(?im)^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"(?:\s+USING\s+([A-Za-z0-9_]+))?\s*\(([^;]+?)\)\s*(?:INCLUDE\s*\(([^)]*)\))?\s*(?:WHERE\s+(.+?))?;\s*$'
    ) | ForEach-Object {
        $keyDefinitions = @()
        $supported = $true
        foreach ($keySql in ($_.Groups[5].Value -split ',')) {
            $keyMatch = [regex]::Match(
                $keySql.Trim(),
                '^"([^"]+)"(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?$',
                [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
            )
            if (-not $keyMatch.Success) {
                $supported = $false
                continue
            }
            $direction = if ($keyMatch.Groups[2].Success) { $keyMatch.Groups[2].Value.ToUpperInvariant() } else { 'ASC' }
            $nullsOrder = if ($keyMatch.Groups[3].Success) { $keyMatch.Groups[3].Value.ToUpperInvariant() } elseif ($direction -eq 'DESC') { 'FIRST' } else { 'LAST' }
            $keyDefinitions += [pscustomobject]@{
                column = $keyMatch.Groups[1].Value
                direction = $direction
                nulls_order = $nullsOrder
            }
        }
        [pscustomobject]@{
            index_name = $_.Groups[2].Value
            is_unique = -not [string]::IsNullOrWhiteSpace($_.Groups[1].Value)
            table_name = $_.Groups[3].Value
            access_method = if ($_.Groups[4].Success) { $_.Groups[4].Value.ToLowerInvariant() } else { 'btree' }
            key_definitions = $keyDefinitions
            included_columns = @(
                if ($_.Groups[6].Success) {
                    foreach ($column in ($_.Groups[6].Value -split ',')) {
                        $includeMatch = [regex]::Match($column.Trim(), '^"([^"]+)"$')
                        if ($includeMatch.Success) {
                            $includeMatch.Groups[1].Value
                        } else {
                            $supported = $false
                        }
                    }
                }
            )
            predicate = if ($_.Groups[7].Success) { $_.Groups[7].Value.Trim() } else { $null }
            supported = $supported
        }
    } | Sort-Object index_name -Unique
)
$indexStatementCount = [regex]::Matches($migrationSql, '(?im)^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b').Count
$unparsedIndexCount = $indexStatementCount - $expectedIndexes.Count
$expectedForeignKeys = @()
$parsedForeignKeyDeclarationCount = 0
$expectedPrimaryKeys = @()
$expectedUniqueConstraints = @()
$migrationColumns = @{}
$migrationColumnDefinitions = @{}
$unparsedMigrationColumnCount = 0
$tableMatches = [regex]::Matches(
    $migrationSql,
    '(?is)CREATE\s+TABLE\s+"([^"]+)"\s*\((.*?)\n\);'
)
foreach ($tableMatch in $tableMatches) {
    $tableName = $tableMatch.Groups[1].Value
    $columns = @(
        [regex]::Matches($tableMatch.Groups[2].Value, '(?m)^\s*"([^"]+)"\s+') |
        ForEach-Object { $_.Groups[1].Value } |
        Where-Object { $_ -notmatch '^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$' }
    )
    $migrationColumns[$tableName] = $columns
    $migrationColumnDefinitions[$tableName] = @{}
    $columnDeclarationCount = [regex]::Matches($tableMatch.Groups[2].Value, '(?im)^\s*"[A-Za-z_][A-Za-z0-9_]*"\s+').Count
    $parsedColumnCount = 0
    foreach ($columnLine in ($tableMatch.Groups[2].Value -split "`r?`n")) {
        $columnMatch = [regex]::Match(
            $columnLine,
            '^\s*"([^"]+)"\s+(TEXT|VARCHAR\(\d+\)|DECIMAL\(\d+\s*,\s*\d+\)|INTEGER|BOOLEAN|TIMESTAMP\(\d+\))\s+(NOT\s+NULL|NULL)(.*?)(?:,)?\s*$',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
        if (-not $columnMatch.Success) {
            continue
        }
        $parsedColumnCount++
        $tail = $columnMatch.Groups[4].Value.Trim()
        $defaultValue = $null
        if ($tail) {
            $defaultMatch = [regex]::Match($tail, '(?i)^DEFAULT\s+(.+)$')
            if ($defaultMatch.Success) {
                $defaultValue = $defaultMatch.Groups[1].Value.Trim()
            }
        }
        $migrationColumnDefinitions[$tableName][$columnMatch.Groups[1].Value] = [pscustomobject]@{
            sql_type = ($columnMatch.Groups[2].Value -replace '\s+', '').ToUpperInvariant()
            nullable = $columnMatch.Groups[3].Value -notmatch '(?i)NOT\s+NULL'
            default = $defaultValue
            supported = (-not $tail -or $null -ne $defaultValue)
        }
    }
    $unparsedMigrationColumnCount += ($columnDeclarationCount - $parsedColumnCount)
    foreach ($foreignKeyMatch in [regex]::Matches(
        $tableMatch.Groups[2].Value,
        '(?im)^\s*CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+"([^"]+)"\s*\(([^)]+)\)([^\r\n,;]*)'
    )) {
        $parsedForeignKeyDeclarationCount++
        $foreignKeyDefinition = 'FOREIGN KEY (' + (($foreignKeyMatch.Groups[2].Value -replace '"', '') -replace '\s+', ' ').Trim() +
            ') REFERENCES ' + $foreignKeyMatch.Groups[3].Value + '(' +
            (($foreignKeyMatch.Groups[4].Value -replace '"', '') -replace '\s+', ' ').Trim() + ')' +
            $foreignKeyMatch.Groups[5].Value
        $expectedForeignKeys += [pscustomobject]@{
            constraint_name = $foreignKeyMatch.Groups[1].Value
            table_name = $tableName
            definition = $foreignKeyDefinition
        }
    }
}
$alteredForeignKeyMatches = [regex]::Matches(
    $migrationSql,
    '(?im)^\s*ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+"([^"]+)"\s*\(([^)]+)\)([^\r\n;]*)'
)
foreach ($foreignKeyMatch in $alteredForeignKeyMatches) {
    $parsedForeignKeyDeclarationCount++
    $foreignKeyDefinition = 'FOREIGN KEY (' + (($foreignKeyMatch.Groups[3].Value -replace '"', '') -replace '\s+', ' ').Trim() +
        ') REFERENCES ' + $foreignKeyMatch.Groups[4].Value + '(' +
        (($foreignKeyMatch.Groups[5].Value -replace '"', '') -replace '\s+', ' ').Trim() + ')' +
        $foreignKeyMatch.Groups[6].Value
    $expectedForeignKeys += [pscustomobject]@{
        constraint_name = $foreignKeyMatch.Groups[2].Value
        table_name = $foreignKeyMatch.Groups[1].Value
        definition = $foreignKeyDefinition
    }
}
$foreignKeyDeclarationCount = [regex]::Matches(
    $migrationSql,
    '(?im)\bCONSTRAINT\s+"[^"]+"\s+FOREIGN\s+KEY\b'
).Count
$unparsedForeignKeyCount = $foreignKeyDeclarationCount - $parsedForeignKeyDeclarationCount
foreach ($tableMatch in $tableMatches) {
    $tableName = $tableMatch.Groups[1].Value
    foreach ($constraintMatch in [regex]::Matches(
        $tableMatch.Groups[2].Value,
        '(?im)^\s*CONSTRAINT\s+"([^"]+)"\s+(PRIMARY\s+KEY|UNIQUE)\s*\(([^)]+)\)'
    )) {
        $constraintColumns = @(
            $constraintMatch.Groups[3].Value -split ',' |
            ForEach-Object { $_.Trim().Trim('"') }
        )
        $expectedConstraint = [pscustomobject]@{
            constraint_name = $constraintMatch.Groups[1].Value
            table_name = $tableName
            columns = $constraintColumns
            definition = if ($constraintMatch.Groups[2].Value -match '^PRIMARY') {
                'PRIMARY KEY (' + ($constraintColumns -join ', ') + ')'
            } else {
                'UNIQUE (' + ($constraintColumns -join ', ') + ')'
            }
        }
        if ($constraintMatch.Groups[2].Value -match '^PRIMARY') {
            $expectedPrimaryKeys += $expectedConstraint
        } else {
            $expectedUniqueConstraints += $expectedConstraint
        }
    }
}
$alteredKeyConstraintMatches = [regex]::Matches(
    $migrationSql,
    '(?im)^\s*ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+(PRIMARY\s+KEY|UNIQUE)\s*\(([^)]+)\)'
)
foreach ($constraintMatch in $alteredKeyConstraintMatches) {
    $constraintColumns = @(
        $constraintMatch.Groups[4].Value -split ',' |
        ForEach-Object { $_.Trim().Trim('"') }
    )
    $expectedConstraint = [pscustomobject]@{
        constraint_name = $constraintMatch.Groups[2].Value
        table_name = $constraintMatch.Groups[1].Value
        columns = $constraintColumns
        definition = if ($constraintMatch.Groups[3].Value -match '^PRIMARY') {
            'PRIMARY KEY (' + ($constraintColumns -join ', ') + ')'
        } else {
            'UNIQUE (' + ($constraintColumns -join ', ') + ')'
        }
    }
    if ($constraintMatch.Groups[3].Value -match '^PRIMARY') {
        $expectedPrimaryKeys += $expectedConstraint
    } else {
        $expectedUniqueConstraints += $expectedConstraint
    }
}
$expectedConstraints = @($expectedPrimaryKeys) + @($expectedUniqueConstraints)
$expectedKeyConstraintStatementCount = [regex]::Matches(
    $migrationSql,
    '(?im)^\s*(?:CONSTRAINT\s+"[^"]+"\s+(?:PRIMARY\s+KEY|UNIQUE)|ALTER\s+TABLE\s+"[^"]+"\s+ADD\s+CONSTRAINT\s+"[^"]+"\s+(?:PRIMARY\s+KEY|UNIQUE))\s*\('
).Count
$unparsedKeyConstraintCount = $expectedKeyConstraintStatementCount - $expectedConstraints.Count

$schemaModels = @(
    [regex]::Matches($schemaText, '(?m)^\s*model\s+([A-Za-z0-9_]+)\s*\{') |
    ForEach-Object { $_.Groups[1].Value }
)
$expectedSchemaPhase2Models = @(
    'ProductCategory', 'Product', 'Inventory', 'StockMovement', 'Customer',
    'Supplier', 'Sale', 'SaleItem', 'PurchaseInvoice', 'PurchaseInvoiceItem', 'Payment'
)
$missingSchemaModels = @(
    $expectedSchemaPhase2Models | Where-Object { $schemaModels -notcontains $_ }
)
$extraMigrationTables = @(
    $expectedMigrationTables | Where-Object { $phase2Tables -notcontains $_ }
)
$missingMigrationTables = @(
    $phase2Tables | Where-Object { $expectedMigrationTables -notcontains $_ }
)
$schemaColumnsByTable = @{}
$schemaColumnDefinitions = @{}
$schemaIndexes = @()
$schemaForeignKeys = @()
$unparsedSchemaFieldCount = 0
$unparsedSchemaIndexCount = 0
$unparsedSchemaForeignKeyCount = 0
$unparsedSchemaMappingCount = 0
$modelMatches = [regex]::Matches(
    $schemaText,
    '(?ms)^\s*model\s+([A-Za-z0-9_]+)\s*\{(.*?)^\s*\}'
)
foreach ($modelMatch in $modelMatches) {
    $modelName = $modelMatch.Groups[1].Value
    if ($expectedSchemaPhase2Models -notcontains $modelName) {
        continue
    }
    $modelBody = $modelMatch.Groups[2].Value
    if ($modelBody -match '(?im)^\s*@@map\(') {
        $unparsedSchemaMappingCount++
    }
    $schemaColumnsByTable[$modelName] = @()
    $schemaColumnDefinitions[$modelName] = @{}
    foreach ($schemaLine in ($modelBody -split "`r?`n")) {
        $fieldMatch = [regex]::Match(
            $schemaLine,
            '^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(String|Int|Decimal|Boolean|DateTime)(\?)?(?:\s+(.*))?$'
        )
        if ($fieldMatch.Success) {
            $fieldName = $fieldMatch.Groups[1].Value
            $fieldType = $fieldMatch.Groups[2].Value
            $fieldOptional = $fieldMatch.Groups[3].Success
            $fieldAttributes = $fieldMatch.Groups[4].Value
            if ($fieldAttributes -match '@map\(') {
                $unparsedSchemaMappingCount++
            }
            $sqlType = $null
            switch ($fieldType) {
                'String' {
                    $nativeType = [regex]::Match($fieldAttributes, '@db\.(VarChar|Char)\((\d+)\)')
                    if ($nativeType.Success -and $nativeType.Groups[1].Value -eq 'VarChar') {
                        $sqlType = 'VARCHAR(' + $nativeType.Groups[2].Value + ')'
                    } elseif ($nativeType.Success) {
                        $sqlType = 'CHAR(' + $nativeType.Groups[2].Value + ')'
                    } elseif ($fieldAttributes -notmatch '@db\.') {
                        $sqlType = 'TEXT'
                    }
                }
                'Int' { $sqlType = 'INTEGER' }
                'Decimal' {
                    $nativeType = [regex]::Match($fieldAttributes, '@db\.Decimal\((\d+)\s*,\s*(\d+)\)')
                    if ($nativeType.Success) {
                        $sqlType = 'DECIMAL(' + $nativeType.Groups[1].Value + ',' + $nativeType.Groups[2].Value + ')'
                    }
                }
                'Boolean' { $sqlType = 'BOOLEAN' }
                'DateTime' { $sqlType = 'TIMESTAMP(3)' }
            }

            $defaultValue = $null
            $hasDefaultAnnotation = $fieldAttributes -match '@default\('
            $defaultMatch = [regex]::Match(
                $fieldAttributes,
                '@default\(("([^"]*)"|(now|cuid)\(\)|-?\d+(?:\.\d+)?|true|false)\)'
            )
            if ($defaultMatch.Success) {
                if ($defaultMatch.Groups[3].Success) {
                    if ($defaultMatch.Groups[3].Value -eq 'now') {
                        $defaultValue = 'CURRENT_TIMESTAMP'
                    }
                } elseif ($defaultMatch.Groups[2].Success) {
                    $defaultValue = "'" + $defaultMatch.Groups[2].Value.Replace("'", "''") + "'"
                } else {
                    $defaultValue = $defaultMatch.Groups[1].Value
                }
            }
            $schemaColumnsByTable[$modelName] += $fieldName
            $schemaColumnDefinitions[$modelName][$fieldName] = [pscustomobject]@{
                sql_type = $sqlType
                nullable = $fieldOptional
                default = $defaultValue
                supported = ($null -ne $sqlType -and (-not $hasDefaultAnnotation -or $defaultMatch.Success))
            }

            if ($fieldAttributes -match '@unique\b') {
                $schemaIndexes += [pscustomobject]@{
                    index_name = $modelName + '_' + $fieldName + '_key'
                    table_name = $modelName
                    columns = @($fieldName)
                    is_unique = $true
                }
            }
            continue
        }

        $relationMatch = [regex]::Match(
            $schemaLine,
            '^\s*[A-Za-z_][A-Za-z0-9_]*\s+([A-Za-z_][A-Za-z0-9_]*)\??\s+@relation(?:\("[^"]+"\))?\(fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\](?<options>[^)]*)\)'
        )
        if ($relationMatch.Success) {
            $localFields = @($relationMatch.Groups[2].Value -split ',' | ForEach-Object { $_.Trim() })
            $referencedFields = @($relationMatch.Groups[3].Value -split ',' | ForEach-Object { $_.Trim() })
            $deleteMatch = [regex]::Match($relationMatch.Groups['options'].Value, '(?i)\bonDelete:\s*(Cascade|Restrict|NoAction|SetNull|SetDefault)')
            $updateMatch = [regex]::Match($relationMatch.Groups['options'].Value, '(?i)\bonUpdate:\s*(Cascade|Restrict|NoAction|SetNull|SetDefault)')
            $supportedRelation = (
                $localFields.Count -gt 0 -and
                $localFields.Count -eq $referencedFields.Count -and
                $deleteMatch.Success -and
                $relationMatch.Groups['options'].Value -notmatch '(?i)\bmap\s*:'
            )
            if ($relationMatch.Groups['options'].Value -match '(?i)\bmap\s*:') {
                $unparsedSchemaForeignKeyCount++
            }
            $foreignKeyDefinition = 'FOREIGN KEY (' + ($localFields -join ', ') + ') REFERENCES ' +
                $relationMatch.Groups[1].Value + '(' + ($referencedFields -join ', ') + ')'
            if ($deleteMatch.Success) {
                $deleteAction = $deleteMatch.Groups[1].Value -creplace 'NoAction', 'NO ACTION' -creplace 'SetNull', 'SET NULL' -creplace 'SetDefault', 'SET DEFAULT'
                $foreignKeyDefinition += ' ON DELETE ' + $deleteAction.ToUpperInvariant()
            }
            if ($updateMatch.Success) {
                $updateAction = $updateMatch.Groups[1].Value -creplace 'NoAction', 'NO ACTION' -creplace 'SetNull', 'SET NULL' -creplace 'SetDefault', 'SET DEFAULT'
                $foreignKeyDefinition += ' ON UPDATE ' + $updateAction.ToUpperInvariant()
            } else {
                $foreignKeyDefinition += ' ON UPDATE CASCADE'
            }
            $schemaForeignKeys += [pscustomobject]@{
                constraint_name = $modelName + '_' + ($localFields -join '_') + '_fkey'
                table_name = $modelName
                definition = $foreignKeyDefinition
                supported = $supportedRelation
            }
        } elseif ($schemaLine -match '@relation\(fields:') {
            $unparsedSchemaForeignKeyCount++
        }

        if ($schemaLine -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s+(String|Int|Decimal|Boolean|DateTime|Json)(?:\[\])?(?:\?)?\s') {
            $unparsedSchemaFieldCount++
        }

        $indexMatch = [regex]::Match(
            $schemaLine,
            '^\s*@@(unique|index)\(\s*\[([^\]]+)\]'
        )
        if ($indexMatch.Success) {
            if ($schemaLine -match '(?i)\bmap\s*:') {
                $unparsedSchemaIndexCount++
            }
            $indexColumns = @($indexMatch.Groups[2].Value -split ',' | ForEach-Object { $_.Trim() })
            $indexIsUnique = $indexMatch.Groups[1].Value -eq 'unique'
            $schemaIndexes += [pscustomobject]@{
                index_name = $modelName + '_' + ($indexColumns -join '_') + $(if ($indexIsUnique) { '_key' } else { '_idx' })
                table_name = $modelName
                columns = $indexColumns
                is_unique = $indexIsUnique
            }
        } elseif ($schemaLine -match '^\s*@@(?:unique|index)\(') {
            $unparsedSchemaIndexCount++
        }

        if ($schemaLine -match '(?i)\bmap\s*:') {
            $unparsedSchemaMappingCount++
        }
        if ($schemaLine -match '^\s*(?:@@id|@id)\b') {
            continue
        }
    }

    $schemaPrimaryKeyFields = @()
    foreach ($schemaLine in ($modelBody -split "`r?`n")) {
        $primaryKeyField = [regex]::Match(
            $schemaLine,
            '^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(?:String|Int|Decimal|Boolean|DateTime)\??\s+.*@id\b'
        )
        if ($primaryKeyField.Success) {
            $schemaPrimaryKeyFields += $primaryKeyField.Groups[1].Value
        }
        $compositePrimaryKey = [regex]::Match($schemaLine, '^\s*@@id\(\s*\[([^\]]+)\]')
        if ($compositePrimaryKey.Success) {
            $schemaPrimaryKeyFields += @($compositePrimaryKey.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() })
        }
    }
    $schemaIndexes += [pscustomobject]@{
        index_name = $modelName + '_pkey'
        table_name = $modelName
        columns = $schemaPrimaryKeyFields
        is_unique = $true
        is_primary = $true
    }
}
$schemaMigrationColumnDifferences = @()
foreach ($table in $expectedSchemaPhase2Models) {
    $schemaColumns = @($schemaColumnsByTable[$table])
    $migrationTableColumns = @($migrationColumns[$table])
    $missingFromMigration = @($schemaColumns | Where-Object { $migrationTableColumns -notcontains $_ })
    $extraInMigration = @($migrationTableColumns | Where-Object { $schemaColumns -notcontains $_ })
    if ($missingFromMigration.Count -or $extraInMigration.Count) {
        $schemaMigrationColumnDifferences += [pscustomobject]@{
            table = $table
            missing_from_migration = $missingFromMigration
            extra_in_migration = $extraInMigration
        }
    }
}

function Normalize-ColumnType {
    param([string]$Type)
    if ([string]::IsNullOrWhiteSpace($Type)) {
        return $null
    }

    $normalized = ($Type -replace '\s+', ' ').Trim().ToLowerInvariant()
    $normalized = $normalized -replace '^varchar\(', 'character varying('
    $normalized = $normalized -replace '^decimal\(', 'numeric('
    if ($normalized -match '^timestamp\((\d+)\)$') {
        $normalized = 'timestamp(' + $Matches[1] + ') without time zone'
    }
    return $normalized
}

function Normalize-SqlDefault {
    param([AllowNull()][string]$Default)
    if ([string]::IsNullOrWhiteSpace($Default)) {
        return ''
    }

    $normalized = ($Default -replace '\s+', ' ').Trim()
    $normalized = [regex]::Replace(
        $normalized,
        '(?i)::(?:character varying(?:\(\d+\))?|text|integer|int4|boolean|bool|numeric(?:\(\d+\s*,\s*\d+\))?|timestamp(?:\(\d+\))?\s+without\s+time\s+zone)',
        ''
    )
    while ($normalized -match '^\((.*)\)$') {
        $normalized = $Matches[1].Trim()
    }
    if ($normalized -match '^(CURRENT_TIMESTAMP|TRUE|FALSE|-?\d+(?:\.\d+)?)$') {
        return $normalized.ToUpperInvariant()
    }
    return $normalized
}

function Normalize-ForeignKeyDefinition {
    param([string]$Definition)
    if ([string]::IsNullOrWhiteSpace($Definition)) {
        return $null
    }

    $text = ($Definition -replace '"', '' -replace '\s+', ' ').Trim()
    $match = [regex]::Match(
        $text,
        '(?i)^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(.*)$'
    )
    if (-not $match.Success) {
        return $null
    }

    $tail = $match.Groups[4].Value
    $actions = @{ DELETE = ''; UPDATE = '' }
    $actionMatches = [regex]::Matches(
        $tail,
        '(?i)\bON\s+(DELETE|UPDATE)\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b'
    )
    foreach ($actionMatch in $actionMatches) {
        $actionType = $actionMatch.Groups[1].Value.ToUpperInvariant()
        if ($actions[$actionType]) {
            return $null
        }
        $actions[$actionType] = ($actionMatch.Groups[2].Value -replace '\s+', ' ').Trim().ToUpperInvariant()
    }
    $remainingTail = [regex]::Replace(
        $tail,
        '(?i)\bON\s+(DELETE|UPDATE)\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)\b',
        ''
    ).Trim()
    if ($remainingTail) {
        return $null
    }

    $columns = (($match.Groups[1].Value -split ',') | ForEach-Object { $_.Trim() }) -join ', '
    $referencedColumns = (($match.Groups[3].Value -split ',') | ForEach-Object { $_.Trim() }) -join ', '
    $normalized = 'FOREIGN KEY (' + $columns + ') REFERENCES ' + $match.Groups[2].Value + '(' + $referencedColumns + ')'
    if ($actions.DELETE) {
        $normalized += ' ON DELETE ' + $actions.DELETE
    }
    if ($actions.UPDATE) {
        $normalized += ' ON UPDATE ' + $actions.UPDATE
    }
    return $normalized
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_pretty(jsonb_build_object(
  'connection', jsonb_build_object(
    'database', current_database(),
    'server_address', host(inet_server_addr()),
    'server_port', inet_server_port()
  ),
  'postgres_server_version', current_setting('server_version'),
  'gen_random_uuid_available', EXISTS (
    SELECT 1
    FROM pg_proc proc
    JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
    WHERE proc.proname = 'gen_random_uuid'
      AND proc.pronargs = 0
      AND proc.prorettype = 'uuid'::regtype
      AND pg_function_is_visible(proc.oid)
  ),
  'migration_history', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'migration_name', migration_name,
      'checksum', checksum,
      'started_at', started_at,
      'finished_at', finished_at,
      'rolled_back_at', rolled_back_at,
      'status', CASE
        WHEN rolled_back_at IS NOT NULL THEN 'rolled_back'
        WHEN finished_at IS NOT NULL THEN 'applied'
        WHEN logs IS NOT NULL THEN 'failed'
        ELSE 'started_or_pending'
      END,
      'failure_diagnostic', CASE
        WHEN logs IS NULL THEN NULL
        WHEN logs ~ '23502' THEN 'PostgreSQL SQLSTATE 23502 (not-null violation)'
        WHEN logs ~ '23505' THEN 'PostgreSQL SQLSTATE 23505 (unique violation)'
        WHEN logs ~ '23503' THEN 'PostgreSQL SQLSTATE 23503 (foreign-key violation)'
        ELSE 'Failure log exists; content intentionally suppressed'
      END
    ) ORDER BY started_at), '[]'::jsonb)
    FROM "_prisma_migrations"
  ),
  'phase1_applied', EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20261105000000_phase1_foundation'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ),
  'phase2_history', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'migration_name', migration_name,
      'checksum', checksum,
      'started_at', started_at,
      'finished_at', finished_at,
      'rolled_back_at', rolled_back_at,
      'status', CASE
        WHEN rolled_back_at IS NOT NULL THEN 'rolled_back'
        WHEN finished_at IS NOT NULL THEN 'applied'
        WHEN logs IS NOT NULL THEN 'failed'
        ELSE 'started_or_pending'
      END,
      'failure_diagnostic', CASE
        WHEN logs IS NULL THEN NULL
        WHEN logs ~ '23502' THEN 'PostgreSQL SQLSTATE 23502 (not-null violation)'
        WHEN logs ~ '23505' THEN 'PostgreSQL SQLSTATE 23505 (unique violation)'
        WHEN logs ~ '23503' THEN 'PostgreSQL SQLSTATE 23503 (foreign-key violation)'
        ELSE 'Failure log exists; content intentionally suppressed'
      END
    ) ORDER BY started_at), '[]'::jsonb)
    FROM "_prisma_migrations"
    WHERE migration_name = '20261106000000_phase2_business_operations'
  ),
  'phase2_tables', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'table_type', table_type
    ) ORDER BY table_name), '[]'::jsonb)
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
        table_name = ANY(ARRAY[
          'ProductCategory','Product','Inventory','StockMovement','Customer',
          'Supplier','Sale','SaleItem','PurchaseInvoice','PurchaseInvoiceItem','Payment'
        ]::text[])
        OR table_name ~* '^(productcategory|product|inventory|stockmovement|customer|supplier|sale|saleitem|purchaseinvoice|purchaseinvoiceitem|payment)'
      )
  ),
  'phase2_columns', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'column_name', column_name,
      'data_type', data_type,
      'udt_name', udt_name,
      'formatted_type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      'is_nullable', is_nullable,
      'column_default', column_default
    ) ORDER BY table_name, ordinal_position), '[]'::jsonb)
    FROM information_schema.columns col
    JOIN pg_namespace namespace ON namespace.nspname = col.table_schema
    JOIN pg_class rel ON rel.relnamespace = namespace.oid
      AND rel.relname = col.table_name
    JOIN pg_attribute attribute ON attribute.attrelid = rel.oid
      AND attribute.attname = col.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    WHERE col.table_schema = 'public'
      AND col.table_name = ANY(ARRAY[
        'ProductCategory','Product','Inventory','StockMovement','Customer',
        'Supplier','Sale','SaleItem','PurchaseInvoice','PurchaseInvoiceItem','Payment'
      ]::text[])
  ),
  'phase2_indexes', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', tbl.relname,
      'index_name', idx.relname,
      'definition', pg_get_indexdef(ind.indexrelid),
      'is_unique', ind.indisunique,
      'access_method', am.amname,
      'is_valid', ind.indisvalid,
      'is_ready', ind.indisready,
      'is_live', ind.indislive,
      'is_constraint_backed', EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conindid = ind.indexrelid AND con.contype IN ('p', 'u')
      ),
      'constraint_names', (
        SELECT COALESCE(jsonb_agg(con.conname ORDER BY con.conname), '[]'::jsonb)
        FROM pg_constraint con
        WHERE con.conindid = ind.indexrelid AND con.contype IN ('p', 'u')
      ),
      'key_columns', (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN key_column.attnum = 0
            THEN pg_get_indexdef(ind.indexrelid, key_column.ordinality::integer, true)
            ELSE att.attname
          END ORDER BY key_column.ordinality
        ), '[]'::jsonb)
        FROM unnest(ind.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        LEFT JOIN pg_attribute att
          ON att.attrelid = tbl.oid AND att.attnum = key_column.attnum
        WHERE key_column.ordinality <= ind.indnkeyatts
      ),
      'key_definitions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'column', CASE WHEN key_column.attnum = 0
            THEN pg_get_indexdef(ind.indexrelid, key_column.ordinality::integer, true)
            ELSE att.attname
          END,
          'direction', CASE WHEN (ind.indoption[key_column.ordinality::integer - 1] & 1) = 1 THEN 'DESC' ELSE 'ASC' END,
          'nulls_order', CASE WHEN (ind.indoption[key_column.ordinality::integer - 1] & 2) = 2 THEN 'FIRST' ELSE 'LAST' END
        ) ORDER BY key_column.ordinality), '[]'::jsonb)
        FROM unnest(ind.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        LEFT JOIN pg_attribute att
          ON att.attrelid = tbl.oid AND att.attnum = key_column.attnum
        WHERE key_column.ordinality <= ind.indnkeyatts
      ),
      'included_columns', (
        SELECT COALESCE(jsonb_agg(att.attname ORDER BY key_column.ordinality), '[]'::jsonb)
        FROM unnest(ind.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute att
          ON att.attrelid = tbl.oid AND att.attnum = key_column.attnum
        WHERE key_column.ordinality > ind.indnkeyatts
      ),
      'predicate', pg_get_expr(ind.indpred, ind.indrelid)
    ) ORDER BY tbl.relname, idx.relname), '[]'::jsonb)
    FROM pg_index ind
    JOIN pg_class tbl ON tbl.oid = ind.indrelid
    JOIN pg_class idx ON idx.oid = ind.indexrelid
    JOIN pg_namespace nsp ON nsp.oid = tbl.relnamespace
    JOIN pg_am am ON am.oid = idx.relam
    WHERE nsp.nspname = 'public'
      AND (
        tbl.relname = ANY(ARRAY[
          'ProductCategory','Product','Inventory','StockMovement','Customer',
          'Supplier','Sale','SaleItem','PurchaseInvoice','PurchaseInvoiceItem','Payment'
        ]::text[])
        OR idx.relname ~* '^(ProductCategory|Product|Inventory|StockMovement|Customer|Supplier|Sale|SaleItem|PurchaseInvoice|PurchaseInvoiceItem|Payment)_'
      )
  ),
  'phase2_constraints', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', rel.relname,
      'constraint_name', con.conname,
      'constraint_type', con.contype,
      'definition', pg_get_constraintdef(con.oid)
    ) ORDER BY rel.relname, con.conname), '[]'::jsonb)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND (
        rel.relname = ANY(ARRAY[
          'ProductCategory','Product','Inventory','StockMovement','Customer',
          'Supplier','Sale','SaleItem','PurchaseInvoice','PurchaseInvoiceItem','Payment'
        ]::text[])
        OR con.conname ~* '^(ProductCategory|Product|Inventory|StockMovement|Customer|Supplier|Sale|SaleItem|PurchaseInvoice|PurchaseInvoiceItem|Payment)_'
      )
  ),
  'permission_definition', (
    SELECT jsonb_agg(jsonb_build_object(
      'column_name', column_name,
      'data_type', data_type,
      'udt_name', udt_name,
      'is_nullable', is_nullable,
      'column_default', column_default
    ) ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Permission'
  ),
  'permission_rows', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'key', key,
      'description', description
    ) ORDER BY key), '[]'::jsonb)
    FROM "Permission"
  ),
  'phase2_role_permissions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role_id', rp."roleId",
      'role_key', r.key,
      'permission_id', p.id,
      'permission_key', p.key
    ) ORDER BY r.key, p.key), '[]'::jsonb)
    FROM "RolePermission" rp
    JOIN "Role" r ON r.id = rp."roleId"
    JOIN "Permission" p ON p.id = rp."permissionId"
    WHERE p.key = ANY(ARRAY[__PHASE2_PERMISSION_KEYS__]::text[])
  ),
  'phase2_permission_status', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'permission_key', required.permission_key,
      'expected_description', required.description,
      'permission_count', (
        SELECT count(*)
        FROM "Permission" permission
        WHERE permission.key = required.permission_key
      ),
      'description_match_count', (
        SELECT count(*)
        FROM "Permission" permission
        WHERE permission.key = required.permission_key
          AND permission.description = required.description
      ),
      'actual_descriptions', COALESCE((
        SELECT jsonb_agg(permission.description ORDER BY permission.id)
        FROM "Permission" permission
        WHERE permission.key = required.permission_key
      ), '[]'::jsonb),
      'all_descriptions_match', COALESCE((
        SELECT bool_and(permission.description = required.description)
        FROM "Permission" permission
        WHERE permission.key = required.permission_key
      ), false),
      'all_ids_non_empty', COALESCE((
        SELECT bool_and(NULLIF(BTRIM(permission.id), '') IS NOT NULL)
        FROM "Permission" permission
        WHERE permission.key = required.permission_key
      ), false)
    ) ORDER BY required.permission_key), '[]'::jsonb)
    FROM (VALUES
      __PHASE2_PERMISSION_SEED_VALUES__
    ) AS required(permission_key, description)
  ),
  'phase2_owner_role_status', jsonb_build_object(
    'owner_role_count', (
      SELECT count(*) FROM "Role" role WHERE role.key = 'owner'
    ),
    'permissions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'permission_key', required.permission_key,
        'owner_role_count', (
          SELECT count(*) FROM "Role" role WHERE role.key = 'owner'
        ),
        'assigned_owner_role_count', (
          SELECT count(DISTINCT role.id)
          FROM "Role" role
          JOIN "RolePermission" mapping ON mapping."roleId" = role.id
          JOIN "Permission" permission ON permission.id = mapping."permissionId"
          WHERE role.key = 'owner' AND permission.key = required.permission_key
        ),
        'duplicate_mapping_count', (
          SELECT COALESCE(sum(duplicates.mapping_count - 1), 0)
          FROM (
            SELECT count(*) AS mapping_count
            FROM "Role" role
            JOIN "RolePermission" mapping ON mapping."roleId" = role.id
            JOIN "Permission" permission ON permission.id = mapping."permissionId"
            WHERE role.key = 'owner' AND permission.key = required.permission_key
            GROUP BY role.id, permission.id
            HAVING count(*) > 1
          ) duplicates
        )
      ) ORDER BY required.permission_key), '[]'::jsonb)
      FROM (VALUES
        __PHASE2_PERMISSION_KEYS_VALUES__
      ) AS required(permission_key)
    )
  )
));
COMMIT;
'@
$sql = $sql.Replace('__PHASE2_PERMISSION_KEYS__', $permissionSeedKeysSql)
$sql = $sql.Replace('__PHASE2_PERMISSION_SEED_VALUES__', $permissionSeedValuesSql)
$sql = $sql.Replace(
    '__PHASE2_PERMISSION_KEYS_VALUES__',
    (($requiredPhase2PermissionKeys | ForEach-Object { "('$_')" }) -join ",`n        ")
)

$pgEnvironmentNames = @(
    'PGPASSWORD', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER',
    'PGDATABASE', 'PGOPTIONS', 'PGSERVICE', 'PGSERVICEFILE'
)
$originalPgEnvironment = @{}
foreach ($name in $pgEnvironmentNames) {
    $originalPgEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$redactionValues = @($rawUrl, $pgPassword, $pgUser, $databaseUrlLine) |
    Where-Object { -not [string]::IsNullOrEmpty($_) } |
    Sort-Object { $_.Length } -Descending

function Protect-Output {
    param([string]$Text)
    $safeText = $Text
    foreach ($secretValue in $redactionValues) {
        $safeText = $safeText.Replace($secretValue, '[REDACTED]')
    }
    return ($safeText -replace '(?i)((?:postgres|postgresql)://)[^\s"''<>@]+@', '$1[REDACTED]@')
}

$psqlStdout = ''
$psqlStderr = ''
$psqlExitCode = $null
$psqlInvocationError = $false
$process = $null

try {
    $env:PGPASSWORD = $pgPassword
    $env:PGHOST = '127.0.0.1'
    $env:PGHOSTADDR = '127.0.0.1'
    $env:PGPORT = '5432'
    $env:PGUSER = $pgUser
    $env:PGDATABASE = 'ubos_development'
    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    $env:PGSERVICE = $null
    $env:PGSERVICEFILE = $null

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $psqlCommand.Source
    $startInfo.Arguments = '-X -q -A -t -v ON_ERROR_STOP=1'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'psql process failed to start.'
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Write($sql)
    $process.StandardInput.Close()
    $process.WaitForExit()
    $psqlStdout = $stdoutTask.Result
    $psqlStderr = $stderrTask.Result
    $psqlExitCode = $process.ExitCode
} catch {
    $psqlInvocationError = $true
} finally {
    if ($process) {
        $process.Dispose()
    }
    foreach ($name in $pgEnvironmentNames) {
        if ($null -eq $originalPgEnvironment[$name]) {
            Remove-Item -LiteralPath "Env:\$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $originalPgEnvironment[$name], 'Process')
        }
    }
    $pgPassword = $null
    $rawUrl = $null
    $userInfo = $null
}

if ($psqlInvocationError -or $psqlExitCode -ne 0) {
    Write-Output 'HOST DATABASE ACCESS: FAILED. No database state is asserted.'
    $safeStdout = Protect-Output $psqlStdout
    $safeStderr = Protect-Output $psqlStderr
    if ($safeStdout.Trim()) { Write-Output $safeStdout }
    if ($safeStderr.Trim()) { Write-Output $safeStderr }
    exit 2
}

$jsonText = $psqlStdout.Trim()
try {
    $report = $jsonText | ConvertFrom-Json
} catch {
    Stop-Diagnostic 'Read-only query completed but its result could not be parsed. No credentials were displayed.'
}

if (
    $report.connection.database -cne 'ubos_development' -or
    $report.connection.server_address -cne '127.0.0.1' -or
    $report.connection.server_port -ne 5432
) {
    Write-Output "Actual server identity: database=$($report.connection.database); server_address=$($report.connection.server_address); server_port=$($report.connection.server_port)"
    Write-Output 'Expected server identity: database=ubos_development; server_address=127.0.0.1; server_port=5432'
    Stop-Diagnostic 'Connected server identity did not match the required target. No database state is asserted.'
}

$actualTables = @($report.phase2_tables | ForEach-Object { $_.table_name })
$actualTableMetadata = @{}
foreach ($actualTable in $report.phase2_tables) {
    $actualTableMetadata[$actualTable.table_name] = $actualTable.table_type
}
$actualExplicitIndexes = @($report.phase2_indexes | Where-Object { -not $_.is_constraint_backed })
$actualConstraintIndexes = @($report.phase2_indexes | Where-Object { $_.is_constraint_backed })
$actualForeignKeys = @(
    $report.phase2_constraints |
    Where-Object { $_.constraint_type -eq 'f' -and $phase2Tables -contains $_.table_name }
)
$actualColumnsByTable = @{}
foreach ($column in $report.phase2_columns) {
    if (-not $actualColumnsByTable.ContainsKey($column.table_name)) {
        $actualColumnsByTable[$column.table_name] = @()
    }
    $actualColumnsByTable[$column.table_name] += $column.column_name
}

$missingTables = @($phase2Tables | Where-Object { $actualTables -notcontains $_ })
$extraTables = @($actualTables | Where-Object { $phase2Tables -notcontains $_ })
$tableTypeDifferences = @(
    foreach ($table in $phase2Tables) {
        if ($actualTableMetadata.ContainsKey($table) -and $actualTableMetadata[$table] -cne 'BASE TABLE') {
            [pscustomobject]@{
                table = $table
                expected_type = 'BASE TABLE'
                actual_type = $actualTableMetadata[$table]
            }
        }
    }
)
$missingIndexes = @()
$mismatchedIndexes = @()
$unsupportedIndexComparisons = @()
foreach ($expectedIndex in $expectedIndexes) {
    $actualIndex = $actualExplicitIndexes |
        Where-Object { $_.index_name -ceq $expectedIndex.index_name } |
        Select-Object -First 1
    if (-not $actualIndex) {
        $missingIndexes += $expectedIndex.index_name
        continue
    }

    if (-not $expectedIndex.supported) {
        $unsupportedIndexComparisons += [pscustomobject]@{
            index_name = $expectedIndex.index_name
            reason = 'Migration index definition contains a key or INCLUDE expression the local parser cannot safely normalize.'
        }
        continue
    }

    $actualKeys = @($actualIndex.key_definitions)
    $expectedKeys = @($expectedIndex.key_definitions)
    $keysMatch = $actualKeys.Count -eq $expectedKeys.Count
    if ($keysMatch) {
        for ($keyIndex = 0; $keyIndex -lt $expectedKeys.Count; $keyIndex++) {
            if (
                [string]$actualKeys[$keyIndex].column -cne [string]$expectedKeys[$keyIndex].column -or
                [string]$actualKeys[$keyIndex].direction -cne [string]$expectedKeys[$keyIndex].direction -or
                [string]$actualKeys[$keyIndex].nulls_order -cne [string]$expectedKeys[$keyIndex].nulls_order
            ) {
                $keysMatch = $false
                break
            }
        }
    }

    $actualIncluded = @($actualIndex.included_columns | ForEach-Object { [string]$_ })
    $expectedIncluded = @($expectedIndex.included_columns | ForEach-Object { [string]$_ })
    $includedMatch = $actualIncluded.Count -eq $expectedIncluded.Count
    if ($includedMatch) {
        for ($includeIndex = 0; $includeIndex -lt $expectedIncluded.Count; $includeIndex++) {
            if ($actualIncluded[$includeIndex] -cne $expectedIncluded[$includeIndex]) {
                $includedMatch = $false
                break
            }
        }
    }

    $predicateMatch = $true
    if ($null -ne $expectedIndex.predicate -or $null -ne $actualIndex.predicate) {
        if ($null -eq $expectedIndex.predicate -or $null -eq $actualIndex.predicate) {
            $predicateMatch = $false
        } else {
            $expectedPredicate = (($expectedIndex.predicate -replace '"\b([A-Za-z_][A-Za-z0-9_]*)"', '$1') -replace '\s+', ' ').Trim()
            $actualPredicate = (([string]$actualIndex.predicate -replace '"\b([A-Za-z_][A-Za-z0-9_]*)"', '$1') -replace '\s+', ' ').Trim()
            if ($expectedPredicate -cne $actualPredicate) {
                $unsupportedIndexComparisons += [pscustomobject]@{
                    index_name = $expectedIndex.index_name
                    reason = 'Partial-index predicate syntax differs textually; semantic equivalence is not inferred.'
                }
                $predicateMatch = $null
            }
        }
    }

    if ($null -eq $predicateMatch) {
        continue
    }

    $actualNullsNotDistinct = [string]$actualIndex.definition -match '(?i)\bNULLS\s+NOT\s+DISTINCT\b'
    if (
        $actualIndex.table_name -cne $expectedIndex.table_name -or
        [bool]$actualIndex.is_unique -ne [bool]$expectedIndex.is_unique -or
        [string]$actualIndex.access_method -cne [string]$expectedIndex.access_method -or
        -not [bool]$actualIndex.is_valid -or
        -not [bool]$actualIndex.is_ready -or
        -not [bool]$actualIndex.is_live -or
        $actualNullsNotDistinct -or
        -not $keysMatch -or
        -not $includedMatch -or
        -not $predicateMatch
    ) {
        $mismatchedIndexes += [pscustomobject]@{
            index_name = $expectedIndex.index_name
            expected_table = $expectedIndex.table_name
            actual_table = $actualIndex.table_name
            expected_unique = $expectedIndex.is_unique
            actual_unique = $actualIndex.is_unique
            actual_valid = $actualIndex.is_valid
            actual_ready = $actualIndex.is_ready
            actual_live = $actualIndex.is_live
            actual_nulls_not_distinct = $actualNullsNotDistinct
            expected_access_method = $expectedIndex.access_method
            actual_access_method = $actualIndex.access_method
            expected_keys = $expectedKeys | ConvertTo-Json -Compress
            actual_keys = $actualKeys | ConvertTo-Json -Compress
            expected_included_columns = $expectedIncluded -join ', '
            actual_included_columns = $actualIncluded -join ', '
            expected_predicate = $expectedIndex.predicate
            actual_predicate = $actualIndex.predicate
            actual_definition = $actualIndex.definition
        }
    }
}
$extraExplicitIndexes = @(
    $actualExplicitIndexes |
    Where-Object {
        (($phase2Tables -contains $_.table_name) -or
         ($_.index_name -match '^(ProductCategory|Product|Inventory|StockMovement|Customer|Supplier|Sale|SaleItem|PurchaseInvoice|PurchaseInvoiceItem|Payment)_')) -and
        ($expectedIndexes.index_name -cnotcontains $_.index_name)
    }
)
$actualKeyConstraints = @(
    $report.phase2_constraints |
    Where-Object { $_.constraint_type -in @('p', 'u') -and $phase2Tables -contains $_.table_name }
)
$expectedConstraintNames = @($expectedConstraints | ForEach-Object { $_.constraint_name })
$missingPrimaryKeys = @()
$mismatchedPrimaryKeys = @()
foreach ($expectedConstraint in $expectedPrimaryKeys) {
    $actualConstraint = $actualKeyConstraints |
        Where-Object { $_.constraint_name -ceq $expectedConstraint.constraint_name } |
        Select-Object -First 1
    if (-not $actualConstraint) {
        $missingPrimaryKeys += $expectedConstraint.constraint_name
    } elseif (
        $actualConstraint.table_name -cne $expectedConstraint.table_name -or
        $actualConstraint.constraint_type -cne 'p' -or
        (($actualConstraint.definition -replace '"', '' -replace '\s+', ' ').Trim()) -cne $expectedConstraint.definition
    ) {
        $mismatchedPrimaryKeys += [pscustomobject]@{
            constraint_name = $expectedConstraint.constraint_name
            expected = $expectedConstraint.definition
            actual = $actualConstraint.definition
        }
    }
}
$missingUniqueConstraints = @()
$mismatchedUniqueConstraints = @()
foreach ($expectedConstraint in $expectedUniqueConstraints) {
    $actualConstraint = $actualKeyConstraints |
        Where-Object { $_.constraint_name -ceq $expectedConstraint.constraint_name } |
        Select-Object -First 1
    if (-not $actualConstraint) {
        $missingUniqueConstraints += $expectedConstraint.constraint_name
    } elseif (
        $actualConstraint.table_name -cne $expectedConstraint.table_name -or
        $actualConstraint.constraint_type -cne 'u' -or
        (($actualConstraint.definition -replace '"', '' -replace '\s+', ' ').Trim()) -cne $expectedConstraint.definition
    ) {
        $mismatchedUniqueConstraints += [pscustomobject]@{
            constraint_name = $expectedConstraint.constraint_name
            expected = $expectedConstraint.definition
            actual = $actualConstraint.definition
        }
    }
}
$extraKeyConstraints = @(
    $actualKeyConstraints |
    Where-Object { $expectedConstraintNames -cnotcontains $_.constraint_name }
)
$extraPrimaryKeys = @($extraKeyConstraints | Where-Object { $_.constraint_type -eq 'p' })
$extraUniqueConstraints = @($extraKeyConstraints | Where-Object { $_.constraint_type -eq 'u' })
$missingForeignKeys = @()
$mismatchedForeignKeys = @()
$unsupportedForeignKeyComparisons = @()
foreach ($expectedForeignKey in $expectedForeignKeys) {
    $actualForeignKey = $actualForeignKeys |
        Where-Object {
            $_.constraint_name -ceq $expectedForeignKey.constraint_name -and
            $_.table_name -ceq $expectedForeignKey.table_name
        } |
        Select-Object -First 1
    $expectedDefinition = Normalize-ForeignKeyDefinition $expectedForeignKey.definition
    if ($null -eq $expectedDefinition) {
        $unsupportedForeignKeyComparisons += [pscustomobject]@{
            constraint_name = $expectedForeignKey.constraint_name
            expected_definition = $expectedForeignKey.definition
            actual_definition = if ($actualForeignKey) { $actualForeignKey.definition } else { $null }
            reason = 'Expected foreign-key definition contains syntax the comparison normalizer does not support.'
        }
        continue
    }
    if (-not $actualForeignKey) {
        $missingForeignKeys += $expectedForeignKey
        continue
    }

    $actualDefinition = Normalize-ForeignKeyDefinition ([string]$actualForeignKey.definition)
    if ($null -eq $actualDefinition) {
        $unsupportedForeignKeyComparisons += [pscustomobject]@{
            constraint_name = $expectedForeignKey.constraint_name
            expected_definition = $expectedForeignKey.definition
            actual_definition = $actualForeignKey.definition
            reason = 'Foreign-key definition contains syntax the comparison normalizer does not support.'
        }
        continue
    }
    if (
        $actualForeignKey.table_name -cne $expectedForeignKey.table_name -or
        $actualDefinition -cne $expectedDefinition
    ) {
        $mismatchedForeignKeys += [pscustomobject]@{
            constraint_name = $expectedForeignKey.constraint_name
            expected_table = $expectedForeignKey.table_name
            actual_table = $actualForeignKey.table_name
            expected_definition = $expectedForeignKey.definition
            actual_definition = $actualForeignKey.definition
        }
    }
}
$extraForeignKeys = @(
    $actualForeignKeys |
    Where-Object {
        $candidate = $_
        -not (@($expectedForeignKeys | Where-Object {
            $_.constraint_name -ceq $candidate.constraint_name -and
            $_.table_name -ceq $candidate.table_name
        }).Count)
    }
)

$columnDifferences = @()
foreach ($table in $migrationColumns.Keys) {
    $expectedColumns = @($migrationColumns[$table])
    $actualColumns = @($actualColumnsByTable[$table])
    $missing = @($expectedColumns | Where-Object { $actualColumns -notcontains $_ })
    $extra = @($actualColumns | Where-Object { $expectedColumns -notcontains $_ })
    if ($missing.Count -or $extra.Count) {
        $columnDifferences += [pscustomobject]@{
            table = $table
            missing = $missing
            unexpected = $extra
        }
    }
}

$columnDefinitionDifferences = @()
$schemaMigrationDefinitionDifferences = @()
$unsupportedColumnComparisons = @()
foreach ($table in $expectedSchemaPhase2Models) {
    $migrationTableDefinitions = @{}
    if ($migrationColumnDefinitions.ContainsKey($table)) {
        $migrationTableDefinitions = $migrationColumnDefinitions[$table]
    }
    foreach ($columnName in @($migrationTableDefinitions.Keys)) {
        $migrationDefinition = $migrationColumnDefinitions[$table][$columnName]
        $schemaDefinition = $null
        if (
            $schemaColumnDefinitions.ContainsKey($table) -and
            $schemaColumnDefinitions[$table].ContainsKey($columnName)
        ) {
            $schemaDefinition = $schemaColumnDefinitions[$table][$columnName]
        }
        $actualColumn = @(
            $report.phase2_columns |
            Where-Object { $_.table_name -ceq $table -and $_.column_name -ceq $columnName }
        ) | Select-Object -First 1

        if (-not $migrationDefinition.supported -or -not $schemaDefinition -or -not $schemaDefinition.supported) {
            $unsupportedColumnComparisons += [pscustomobject]@{
                table = $table
                column = $columnName
                reason = 'Migration or Prisma column type/default syntax was not fully parsed.'
            }
            continue
        }

        if (
            (Normalize-ColumnType $migrationDefinition.sql_type) -cne (Normalize-ColumnType $schemaDefinition.sql_type) -or
            [bool]$migrationDefinition.nullable -ne [bool]$schemaDefinition.nullable -or
            (Normalize-SqlDefault $migrationDefinition.default) -cne (Normalize-SqlDefault $schemaDefinition.default)
        ) {
            $schemaMigrationDefinitionDifferences += [pscustomobject]@{
                table = $table
                column = $columnName
                migration = $migrationDefinition
                prisma = $schemaDefinition
            }
        }

        if (-not $actualColumn) {
            continue
        }
        $actualNullable = [string]$actualColumn.is_nullable -ceq 'YES'
        if (
            (Normalize-ColumnType $migrationDefinition.sql_type) -cne (Normalize-ColumnType ([string]$actualColumn.formatted_type)) -or
            [bool]$migrationDefinition.nullable -ne $actualNullable -or
            (Normalize-SqlDefault $migrationDefinition.default) -cne (Normalize-SqlDefault ([string]$actualColumn.column_default))
        ) {
            $columnDefinitionDifferences += [pscustomobject]@{
                table = $table
                column = $columnName
                expected_type = $migrationDefinition.sql_type
                actual_type = $actualColumn.formatted_type
                expected_nullable = $migrationDefinition.nullable
                actual_nullable = $actualNullable
                expected_default = $migrationDefinition.default
                actual_default = $actualColumn.column_default
            }
        }
    }
}

$schemaIndexDifferences = @()
$schemaExplicitIndexes = @($schemaIndexes | Where-Object { -not $_.is_primary })
foreach ($expectedIndex in $expectedIndexes) {
    $schemaIndex = $schemaExplicitIndexes |
        Where-Object { $_.index_name -ceq $expectedIndex.index_name } |
        Select-Object -First 1
    if (-not $schemaIndex) {
        $schemaIndexDifferences += [pscustomobject]@{
            index_name = $expectedIndex.index_name
            issue = 'Migration index is missing from Prisma schema declarations.'
        }
        continue
    }
    $migrationIndexColumns = @($expectedIndex.key_definitions | ForEach-Object { $_.column })
    if (
        $schemaIndex.table_name -cne $expectedIndex.table_name -or
        [bool]$schemaIndex.is_unique -ne [bool]$expectedIndex.is_unique -or
        (($schemaIndex.columns -join ',') -cne ($migrationIndexColumns -join ','))
    ) {
        $schemaIndexDifferences += [pscustomobject]@{
            index_name = $expectedIndex.index_name
            migration = $expectedIndex
            prisma = $schemaIndex
            issue = 'Index table, uniqueness, or ordered key columns differ.'
        }
    }
}
foreach ($schemaIndex in $schemaExplicitIndexes) {
    if (@($expectedIndexes | Where-Object { $_.index_name -ceq $schemaIndex.index_name }).Count -eq 0) {
        $schemaIndexDifferences += [pscustomobject]@{
            index_name = $schemaIndex.index_name
            issue = 'Prisma schema index is missing from the Phase 2 migration.'
        }
    }
}

$schemaForeignKeyDifferences = @()
foreach ($schemaForeignKey in $schemaForeignKeys) {
    $migrationForeignKey = $expectedForeignKeys |
        Where-Object {
            $_.constraint_name -ceq $schemaForeignKey.constraint_name -and
            $_.table_name -ceq $schemaForeignKey.table_name
        } |
        Select-Object -First 1
    if (-not $schemaForeignKey.supported) {
        $unparsedSchemaForeignKeyCount++
        continue
    }
    if (-not $migrationForeignKey) {
        $schemaForeignKeyDifferences += [pscustomobject]@{
            constraint_name = $schemaForeignKey.constraint_name
            issue = 'Prisma relation is missing from the Phase 2 migration.'
        }
        continue
    }
    $migrationDefinition = Normalize-ForeignKeyDefinition $migrationForeignKey.definition
    $schemaDefinition = Normalize-ForeignKeyDefinition $schemaForeignKey.definition
    if ($null -eq $migrationDefinition -or $null -eq $schemaDefinition) {
        $unparsedSchemaForeignKeyCount++
    } elseif ($migrationDefinition -cne $schemaDefinition) {
        $schemaForeignKeyDifferences += [pscustomobject]@{
            constraint_name = $schemaForeignKey.constraint_name
            migration = $migrationForeignKey.definition
            prisma = $schemaForeignKey.definition
        }
    }
}
foreach ($migrationForeignKey in $expectedForeignKeys) {
    if (@($schemaForeignKeys | Where-Object {
        $_.constraint_name -ceq $migrationForeignKey.constraint_name -and
        $_.table_name -ceq $migrationForeignKey.table_name
    }).Count -eq 0) {
        $schemaForeignKeyDifferences += [pscustomobject]@{
            constraint_name = $migrationForeignKey.constraint_name
            issue = 'Migration foreign key is missing from Prisma relation declarations.'
        }
    }
}

$schemaPrimaryKeyDifferences = @()
foreach ($migrationPrimaryKey in $expectedPrimaryKeys) {
    $schemaPrimaryKey = @(
        $schemaIndexes |
        Where-Object {
            $_.is_primary -and
            $_.index_name -ceq $migrationPrimaryKey.constraint_name -and
            $_.table_name -ceq $migrationPrimaryKey.table_name
        }
    ) | Select-Object -First 1
    if (
        -not $schemaPrimaryKey -or
        (($schemaPrimaryKey.columns -join ',') -cne ($migrationPrimaryKey.columns -join ','))
    ) {
        $schemaPrimaryKeyDifferences += [pscustomobject]@{
            constraint_name = $migrationPrimaryKey.constraint_name
            migration_columns = $migrationPrimaryKey.columns
            prisma_columns = if ($schemaPrimaryKey) { $schemaPrimaryKey.columns } else { @() }
        }
    }
}

$phase2HistoryRows = @($report.phase2_history)
$phase2Failed = @($phase2HistoryRows | Where-Object { $_.status -eq 'failed' }).Count -gt 0
$phase2Applied = @($phase2HistoryRows | Where-Object { $_.status -eq 'applied' }).Count -gt 0
$phase1Applied = [bool]$report.phase1_applied
$permissionStatus = @($report.phase2_permission_status)
$missingPermissionKeys = @(
    $permissionStatus |
    Where-Object { [int]$_.permission_count -eq 0 } |
    ForEach-Object { $_.permission_key }
)
$duplicatePermissionKeys = @(
    $permissionStatus |
    Where-Object { [int]$_.permission_count -gt 1 } |
    ForEach-Object { $_.permission_key }
)
$permissionsWithEmptyIds = @(
    $permissionStatus |
    Where-Object { [int]$_.permission_count -gt 0 -and -not [bool]$_.all_ids_non_empty } |
    ForEach-Object { $_.permission_key }
)
$permissionDescriptionMismatches = @(
    $permissionStatus |
    Where-Object { [int]$_.permission_count -gt 0 -and -not [bool]$_.all_descriptions_match } |
    ForEach-Object { $_.permission_key }
)
$permissionIssues = (
    $missingPermissionKeys.Count -gt 0 -or
    $duplicatePermissionKeys.Count -gt 0 -or
    $permissionsWithEmptyIds.Count -gt 0 -or
    $permissionDescriptionMismatches.Count -gt 0
)
$ownerRoleStatus = $report.phase2_owner_role_status
$ownerRoleCount = [int]$ownerRoleStatus.owner_role_count
$missingOwnerRolePermissions = @(
    $ownerRoleStatus.permissions |
    Where-Object { [int]$_.assigned_owner_role_count -lt [int]$_.owner_role_count } |
    ForEach-Object { $_.permission_key }
)
$duplicateOwnerRoleMappings = @(
    $ownerRoleStatus.permissions |
    Where-Object { [int]$_.duplicate_mapping_count -gt 0 } |
    ForEach-Object { $_.permission_key }
)
$rolePermissionIssues = (
    $ownerRoleCount -eq 0 -or
    $missingOwnerRolePermissions.Count -gt 0 -or
    $duplicateOwnerRoleMappings.Count -gt 0
)
$migrationFileChecksum = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
$phase2ChecksumComparisons = @(
    foreach ($historyRow in $phase2HistoryRows) {
        [pscustomobject]@{
            migration_name = $historyRow.migration_name
            database_checksum = $historyRow.checksum
            current_file_sha256 = $migrationFileChecksum
            comparison = if ([string]::IsNullOrWhiteSpace([string]$historyRow.checksum)) {
                'not_comparable'
            } elseif ([string]$historyRow.checksum -ieq $migrationFileChecksum) {
                'matches'
            } else {
                'differs'
            }
        }
    }
)
$migrationHistoryConsistent = (
    $phase2HistoryRows.Count -eq 1 -and
    $phase2ChecksumComparisons.Count -eq 1 -and
    $phase2ChecksumComparisons[0].comparison -eq 'matches' -and
    $phase2HistoryRows[0].status -ne 'started_or_pending'
)
$genRandomUuidAvailable = [bool]$report.gen_random_uuid_available
$comparisonIncomplete = (
    $permissionSeedIssues.Count -gt 0 -or
    $unparsedIndexCount -gt 0 -or
    $unparsedKeyConstraintCount -gt 0 -or
    $unparsedForeignKeyCount -gt 0 -or
    $unparsedMigrationColumnCount -gt 0 -or
    $unparsedSchemaFieldCount -gt 0 -or
    $unparsedSchemaIndexCount -gt 0 -or
    $unparsedSchemaForeignKeyCount -gt 0 -or
    $unparsedSchemaMappingCount -gt 0 -or
    $unsupportedColumnComparisons.Count -gt 0 -or
    $unsupportedForeignKeyComparisons.Count -gt 0 -or
    $unsupportedIndexComparisons.Count -gt 0 -or
    $missingSchemaModels.Count -gt 0 -or
    $missingMigrationTables.Count -gt 0 -or
    $extraMigrationTables.Count -gt 0
)
$phase2DdlEquivalent = (
    -not $comparisonIncomplete -and
    $missingTables.Count -eq 0 -and
    $extraTables.Count -eq 0 -and
    $tableTypeDifferences.Count -eq 0 -and
    $missingIndexes.Count -eq 0 -and
    $mismatchedIndexes.Count -eq 0 -and
    $extraExplicitIndexes.Count -eq 0 -and
    $missingPrimaryKeys.Count -eq 0 -and
    $mismatchedPrimaryKeys.Count -eq 0 -and
    $missingUniqueConstraints.Count -eq 0 -and
    $mismatchedUniqueConstraints.Count -eq 0 -and
    $extraKeyConstraints.Count -eq 0 -and
    $missingForeignKeys.Count -eq 0 -and
    $mismatchedForeignKeys.Count -eq 0 -and
    $extraForeignKeys.Count -eq 0 -and
    $columnDifferences.Count -eq 0 -and
    $columnDefinitionDifferences.Count -eq 0 -and
    $schemaMigrationColumnDifferences.Count -eq 0 -and
    $schemaMigrationDefinitionDifferences.Count -eq 0 -and
    $schemaIndexDifferences.Count -eq 0 -and
    $schemaForeignKeyDifferences.Count -eq 0 -and
    $schemaPrimaryKeyDifferences.Count -eq 0
)
$allPhase2SeedsComplete = -not $permissionIssues -and -not $rolePermissionIssues
$permissionRowCount = 0
foreach ($permission in $permissionStatus) {
    $permissionRowCount += [int]$permission.permission_count
}
$noPhase2ObjectsOrSeedsPersisted = (
    $actualTables.Count -eq 0 -and
    $actualExplicitIndexes.Count -eq 0 -and
    $actualConstraintIndexes.Count -eq 0 -and
    $actualForeignKeys.Count -eq 0 -and
    [int]$permissionRowCount -eq 0 -and
    @($report.phase2_role_permissions).Count -eq 0
)
$recoveryRecommendation = if ($phase2Failed -and -not $genRandomUuidAvailable -and -not $allPhase2SeedsComplete) {
    'No recovery action is supported until the required ID-generation function is available or an approved alternative is selected. The diagnostic only checks function existence and does not invoke it.'
} elseif ($phase2Failed -and $phase2DdlEquivalent) {
    if ($allPhase2SeedsComplete) {
        'Safe manual completion is supported only for migration-history reconciliation: the reported Phase 2 DDL and seed checks are complete. Verify the checksum/history evidence before any applied-resolution action.'
    } else {
        'Safe manual completion is preferred over replaying DDL: the schema comparison reports equivalent DDL, while the seed/owner-mapping section identifies the remaining data work. Complete only verified missing seed entries and mappings.'
    }
} elseif ($phase2Failed -and $noPhase2ObjectsOrSeedsPersisted) {
    'Rolled-back redeployment is the safer path: no expected Phase 2 tables, indexes, constraints, permission rows, or Phase 2 role mappings are reported as persisted. Confirm this entire report before marking the failed attempt rolled back and redeploying.'
} elseif ($phase2Failed) {
    'Neither manual completion nor rolled-back redeployment is supported by this mixed or incomplete evidence. Do not retry or reconcile yet; resolve each reported mismatch/unsupported comparison and inspect the state before choosing.'
} else {
    'No failed Phase 2 migration was identified; no recovery action is recommended from this report alone.'
}

Write-Output ''
Write-Output 'READ-ONLY DATABASE DIAGNOSTIC REPORT'
Write-Output 'Target: PostgreSQL 127.0.0.1:5432 / ubos_development'
Write-Output 'Transaction: BEGIN TRANSACTION READ ONLY ... COMMIT'
Write-Output ''
Write-Output 'Migration history (logs suppressed; only categorized failure diagnostic is reported):'
$report.migration_history | Format-Table migration_name, checksum, started_at, finished_at, rolled_back_at, status, failure_diagnostic -AutoSize | Out-String | Write-Output
Write-Output "Phase 1 applied: $phase1Applied"
Write-Output "Phase 2 recorded failed: $phase2Failed"
Write-Output "Phase 2 recorded applied: $phase2Applied"
Write-Output "PostgreSQL server version: $($report.postgres_server_version)"
Write-Output "gen_random_uuid() available to the session: $genRandomUuidAvailable"
Write-Output "Current Phase 2 migration file SHA-256: $migrationFileChecksum"
Write-Output 'Phase 2 migration-history checksum and current-file SHA-256 comparison (reported separately; equality is not assumed):'
if ($phase2ChecksumComparisons.Count) {
    $phase2ChecksumComparisons |
        Format-Table migration_name, database_checksum, current_file_sha256, comparison -Wrap -AutoSize |
        Out-String -Width 240 | Write-Output
} else {
    Write-Output '  No Phase 2 migration-history row exists for comparison.'
}
Write-Output "Phase 2 migration-history consistency assessment: $migrationHistoryConsistent"
Write-Output ''
Write-Output 'Phase 2 tables found:'
if ($actualTables.Count) { $actualTables | Sort-Object | ForEach-Object { Write-Output "  $_" } } else { Write-Output '  (none)' }
Write-Output "Missing expected tables: $($missingTables -join ', ')"
Write-Output "Unexpected likely Phase 2 tables: $($extraTables -join ', ')"
Write-Output "Expected base tables with a different actual relation type:"
if ($tableTypeDifferences.Count) { $tableTypeDifferences | Format-List | Out-String | Write-Output } else { Write-Output '  (none)' }
Write-Output "Phase 2 migration tables absent from expected list: $($extraMigrationTables -join ', ')"
Write-Output "Expected Phase 2 tables absent from migration SQL: $($missingMigrationTables -join ', ')"
Write-Output ''
Write-Output 'Expected index comparison:'
Write-Output "  Explicit migration indexes expected: $($expectedIndexes.Count)"
Write-Output "  Unparsed CREATE INDEX statements: $unparsedIndexCount"
Write-Output '  Expected explicit index definitions:'
$expectedIndexes |
    Format-Table index_name, table_name, is_unique, access_method, key_definitions, included_columns, predicate, supported -Wrap -AutoSize |
    Out-String -Width 240 | Write-Output
Write-Output "  Missing explicit indexes: $($missingIndexes -join ', ')"
Write-Output "  Explicit index definition mismatches:"
if ($mismatchedIndexes.Count) {
    $mismatchedIndexes | Format-List | Out-String | Write-Output
} else {
    Write-Output '    (none)'
}
Write-Output "  Unexpected explicit indexes on Phase 2 tables: $(($extraExplicitIndexes | ForEach-Object { $_.index_name }) -join ', ')"
Write-Output '  Actual explicit Phase 2 index names and definitions:'
if ($actualExplicitIndexes.Count) {
    $actualExplicitIndexes |
        Sort-Object table_name, index_name |
        Format-Table table_name, index_name, is_unique, key_columns, definition -Wrap -AutoSize |
        Out-String -Width 300 | Write-Output
} else {
    Write-Output '    (none)'
}
Write-Output '  Constraint-backed indexes (primary/unique) reported separately:'
Write-Output "  Unparsed expected PK/UNIQUE constraints: $unparsedKeyConstraintCount"
Write-Output "  Missing primary-key constraints: $($missingPrimaryKeys -join ', ')"
Write-Output "  Mismatched primary-key constraints:"
if ($mismatchedPrimaryKeys.Count) { $mismatchedPrimaryKeys | Format-List | Out-String | Write-Output } else { Write-Output '    (none)' }
Write-Output "  Missing unique constraints: $($missingUniqueConstraints -join ', ')"
Write-Output "  Mismatched unique constraints:"
if ($mismatchedUniqueConstraints.Count) { $mismatchedUniqueConstraints | Format-List | Out-String | Write-Output } else { Write-Output '    (none)' }
Write-Output "  Unexpected primary-key constraints:"
if ($extraPrimaryKeys.Count) { $extraPrimaryKeys | Format-Table table_name, constraint_name, definition -Wrap -AutoSize | Out-String -Width 240 | Write-Output } else { Write-Output '    (none)' }
Write-Output "  Unexpected unique constraints:"
if ($extraUniqueConstraints.Count) { $extraUniqueConstraints | Format-Table table_name, constraint_name, definition -Wrap -AutoSize | Out-String -Width 240 | Write-Output } else { Write-Output '    (none)' }
if ($actualConstraintIndexes.Count) {
    $actualConstraintIndexes |
        Sort-Object table_name, index_name |
        Format-Table table_name, index_name, constraint_names, is_unique, key_columns, definition -Wrap -AutoSize |
        Out-String -Width 300 | Write-Output
} else {
    Write-Output '    (none)'
}
Write-Output ''
Write-Output 'Expected foreign-key comparison:'
Write-Output "  Parsed expected foreign keys: $($expectedForeignKeys.Count)"
Write-Output "  Unparsed foreign-key declarations: $unparsedForeignKeyCount"
Write-Output "  Missing: $(($missingForeignKeys | ForEach-Object { $_.constraint_name + ' on ' + $_.table_name }) -join ', ')"
Write-Output '  Definition/table mismatches:'
if ($mismatchedForeignKeys.Count) { $mismatchedForeignKeys | Format-List | Out-String | Write-Output } else { Write-Output '    (none)' }
Write-Output '  Unsupported foreign-key comparisons:'
if ($unsupportedForeignKeyComparisons.Count) { $unsupportedForeignKeyComparisons | Format-List | Out-String | Write-Output } else { Write-Output '    (none)' }
Write-Output "  Unexpected Phase 2 foreign keys: $(($extraForeignKeys | ForEach-Object { $_.constraint_name + ' on ' + $_.table_name }) -join ', ')"
Write-Output '  Actual Phase 2 foreign-key constraints and definitions:'
$actualForeignKeys |
    Sort-Object table_name, constraint_name |
    Format-Table table_name, constraint_name, definition -Wrap -AutoSize |
    Out-String -Width 300 | Write-Output
Write-Output ''
Write-Output 'Column comparison against migration CREATE TABLE statements:'
if ($columnDifferences.Count) {
    $columnDifferences | Format-List | Out-String | Write-Output
} else {
    Write-Output '  No column-name differences detected.'
}
Write-Output "Unparsed migration column declarations: $unparsedMigrationColumnCount"
Write-Output 'Actual PostgreSQL type/nullability/default differences from migration:'
if ($columnDefinitionDifferences.Count) {
    $columnDefinitionDifferences | Format-List | Out-String | Write-Output
} else {
    Write-Output '  (none)'
}
Write-Output "Phase 2 model names missing from Prisma schema: $($missingSchemaModels -join ', ')"
Write-Output 'Prisma scalar-column comparison against migration SQL:'
if ($schemaMigrationColumnDifferences.Count) {
    $schemaMigrationColumnDifferences | Format-List | Out-String | Write-Output
} else {
    Write-Output '  No Prisma-schema/migration column-name differences detected.'
}
Write-Output "Unparsed Prisma scalar fields: $unparsedSchemaFieldCount"
Write-Output "Unparsed Prisma @map/@@map declarations: $unparsedSchemaMappingCount"
Write-Output 'Prisma-to-migration type/nullability/default differences:'
if ($schemaMigrationDefinitionDifferences.Count) {
    $schemaMigrationDefinitionDifferences | Format-List | Out-String | Write-Output
} else {
    Write-Output '  (none)'
}
Write-Output 'Unsupported column comparisons:'
if ($unsupportedColumnComparisons.Count) { $unsupportedColumnComparisons | Format-List | Out-String | Write-Output } else { Write-Output '  (none)' }
Write-Output 'Prisma index declarations compared with migration indexes:'
Write-Output "Unparsed Prisma index declarations: $unparsedSchemaIndexCount"
if ($schemaIndexDifferences.Count) { $schemaIndexDifferences | Format-List | Out-String | Write-Output } else { Write-Output '  No Prisma/migration index differences detected.' }
Write-Output 'Prisma relation declarations compared with migration foreign keys:'
Write-Output "Unparsed Prisma foreign-key relations: $unparsedSchemaForeignKeyCount"
if ($schemaForeignKeyDifferences.Count) { $schemaForeignKeyDifferences | Format-List | Out-String | Write-Output } else { Write-Output '  No Prisma/migration foreign-key differences detected.' }
if ($schemaPrimaryKeyDifferences.Count) {
    Write-Output 'Prisma/migration primary-key differences:'
    $schemaPrimaryKeyDifferences | Format-List | Out-String | Write-Output
} else {
    Write-Output 'Prisma/migration primary keys: no differences detected.'
}
Write-Output ''
Write-Output 'Permission table definition:'
if ($report.permission_definition) {
    $report.permission_definition | Format-Table column_name, data_type, udt_name, is_nullable, column_default -AutoSize | Out-String | Write-Output
} else {
    Write-Output '  Permission table is absent.'
}
Write-Output 'Existing Permission IDs and keys:'
if ($report.permission_rows) {
    $report.permission_rows | Format-Table id, key, description -Wrap -AutoSize | Out-String -Width 220 | Write-Output
} else {
    Write-Output '  (none)'
}
Write-Output 'RolePermission rows for Phase 2 permission keys:'
if ($report.phase2_role_permissions) {
    $report.phase2_role_permissions | Format-Table role_id, role_key, permission_id, permission_key -AutoSize | Out-String | Write-Output
} else {
    Write-Output '  (none)'
}
Write-Output 'Required Phase 2 Permission key validation:'
Write-Output 'Permission seed parsing from migration.sql:'
if ($permissionSeedIssues.Count) {
    $permissionSeedIssues | ForEach-Object { Write-Output "  $_" }
} else {
    Write-Output '  All required permission keys and descriptions were parsed from migration.sql.'
}
$permissionStatus |
    Sort-Object permission_key |
    Format-Table permission_key, expected_description, permission_count, description_match_count, all_descriptions_match, all_ids_non_empty -Wrap -AutoSize |
    Out-String | Write-Output
Write-Output "Missing required permission keys: $($missingPermissionKeys -join ', ')"
Write-Output "Duplicate required permission keys: $($duplicatePermissionKeys -join ', ')"
Write-Output "Required permission keys with one or more empty IDs: $($permissionsWithEmptyIds -join ', ')"
Write-Output "Required permission keys with description mismatches: $($permissionDescriptionMismatches -join ', ')"
Write-Output "Owner role count: $ownerRoleCount"
Write-Output 'Owner-role mapping validation by required permission:'
$ownerRoleStatus.permissions |
    Sort-Object permission_key |
    Format-Table permission_key, owner_role_count, assigned_owner_role_count, duplicate_mapping_count -AutoSize |
    Out-String | Write-Output
Write-Output "Required permissions missing from one or more owner roles: $($missingOwnerRolePermissions -join ', ')"
Write-Output "Duplicate owner-role permission mappings: $($duplicateOwnerRoleMappings -join ', ')"
Write-Output "All Phase 2 permission seed data and owner-role mappings complete: $allPhase2SeedsComplete"
Write-Output "All Phase 2 DDL present and equivalent across migration, Prisma schema, and live database: $phase2DdlEquivalent"
Write-Output "Recommended recovery path: $recoveryRecommendation"

if ($comparisonIncomplete) {
    Write-Output ''
    Write-Output "ASSESSMENT: INCOMPLETE. At least one required schema comparison is unsupported or unparsed; live schema equivalence is not asserted. Permission issues: missing=[$($missingPermissionKeys -join ', ')], duplicate=[$($duplicatePermissionKeys -join ', ')], descriptions=[$($permissionDescriptionMismatches -join ', ')], empty IDs=[$($permissionsWithEmptyIds -join ', ')]."
} elseif (-not $phase2DdlEquivalent) {
    Write-Output ''
    Write-Output 'ASSESSMENT: Phase 2 DDL is not fully present and equivalent. Review every reported mismatch before recovery.'
} elseif ($permissionIssues -or $rolePermissionIssues) {
    Write-Output ''
    Write-Output 'ASSESSMENT: DDL comparisons match, but required Phase 2 permission seed data or owner-role mappings are incomplete or inconsistent.'
} elseif ($phase2Failed) {
    Write-Output ''
    Write-Output 'ASSESSMENT: DDL and required seed comparisons match, but migration history records failure. Review checksum and history evidence before reconciling migration state.'
} elseif ($phase2Applied) {
    Write-Output ''
    Write-Output 'ASSESSMENT: Phase 2 is recorded applied and all supported schema/seed comparisons match. Confirm the migration-history checksum result before treating history as consistent.'
} else {
    Write-Output ''
    Write-Output 'ASSESSMENT: No failed/applied Phase 2 row was identified; migration history and object comparison require review.'
}
