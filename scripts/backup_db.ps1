<#
.SYNOPSIS
    Backup la DB SQLite de bot-montage avec rotation 7 jours.

.DESCRIPTION
    Utilise `sqlite3 .backup` (online backup, safe même quand l'app
    écrit en parallèle — SQLite gère via le WAL). Copie le résultat
    dans C:\Botmontage\backups\botmontage-YYYY-MM-DD.db et garde les
    7 derniers fichiers.

    À lancer 1× par jour via Windows Task Scheduler (cf README ops).

.NOTES
    Phase 39 — sécurité ops. Avant : aucun backup, perte de VM =
    perte totale (templates, users, jobs, tags, crédits).

    Si tu veux push offsite (Google Drive / S3 / etc.), ajoute le
    bloc à la fin via rclone : `rclone copy ... remote:botmontage-backups`
#>

$ErrorActionPreference = "Stop"

$dbPath     = "C:\Botmontage\data\botmontage.db"
$backupDir  = "C:\Botmontage\backups"
$keepDays   = 7
$sqliteExe  = (Get-Command sqlite3 -ErrorAction SilentlyContinue).Source

# 1. sqlite3 dispo ? Si pas, fallback Copy-Item (moins safe mais marche
# vu que SQLite WAL est append-only sur le fichier principal).
if (-not $sqliteExe) {
    Write-Host "sqlite3 introuvable, fallback Copy-Item" -ForegroundColor Yellow
}

# 2. Backup dir
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# 3. Nom du fichier de backup avec timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$dst = Join-Path $backupDir "botmontage-$timestamp.db"

# 4. Backup
Write-Host "Backup $dbPath -> $dst" -ForegroundColor Cyan
if ($sqliteExe) {
    # Online backup (gère les locks WAL proprement)
    & $sqliteExe $dbPath ".backup '$dst'"
} else {
    Copy-Item $dbPath $dst -Force
}

if (-not (Test-Path $dst)) {
    Write-Host "ECHEC: backup non créé" -ForegroundColor Red
    exit 1
}

$size = [math]::Round((Get-Item $dst).Length / 1KB, 1)
Write-Host "OK ($size KB)" -ForegroundColor Green

# 5. Rotation : supprime les backups > keepDays jours
$cutoff = (Get-Date).AddDays(-$keepDays)
$deleted = 0
Get-ChildItem $backupDir -Filter "botmontage-*.db" | Where-Object {
    $_.LastWriteTime -lt $cutoff
} | ForEach-Object {
    Remove-Item $_.FullName -Force
    $deleted++
}
if ($deleted -gt 0) {
    Write-Host "Rotation: $deleted vieux backup(s) supprimé(s)" -ForegroundColor Gray
}

# 6. Liste les backups actuels pour traçabilité
Write-Host ""
Write-Host "Backups actuels:" -ForegroundColor Cyan
Get-ChildItem $backupDir -Filter "botmontage-*.db" |
    Sort-Object LastWriteTime -Descending |
    Select-Object Name, @{N='Size(KB)';E={[math]::Round($_.Length/1KB,1)}}, LastWriteTime |
    Format-Table -AutoSize
