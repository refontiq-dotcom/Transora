# ============================================
# Script de Sauvegarde — TRANSORA
# Usage : powershell -File backup-project.ps1
# ============================================
param(
    [string]$TargetDrive = "D",
    [string]$BackupName = "transora-backup"
)

$ErrorActionPreference = "Stop"

# Configuration
$SourcePath = Split-Path $MyInvocation.MyCommand.Path -Parent
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = Join-Path $TargetDrive ":\" "$BackupName-$Timestamp"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TRANSORA - Script de Sauvegarde" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier que le répertoire source existe
if (-not (Test-Path $SourcePath)) {
    Write-Host "[ERREUR] Répertoire source introuvable : $SourcePath" -ForegroundColor Red
    exit 1
}

# Vérifier l'espace disponible sur le lecteur cible
$Drive = Get-PSDrive $TargetDrive -ErrorAction SilentlyContinue
if (-not $Drive) {
    Write-Host "[ERREUR] Lecteur `$TargetDrive` non trouvé." -ForegroundColor Red
    exit 1
}
$FreeGB = [math]::Round($Drive.Free / 1GB, 2)
$SourceSizeGB = [math]::Round((Get-ChildItem $SourcePath -Recurse -Force | Measure-Object Length -Sum).Sum / 1GB, 2)
Write-Host "[INFO] Espace libre sur `$TargetDrive` : ${FreeGB} Go" -ForegroundColor Green
Write-Host "[INFO] Taille estimée du projet : ~${SourceSizeGB} Go" -ForegroundColor Green
Write-Host ""

# Demander confirmation si l'espace est insuffisant
if ([float]$FreeGB -lt [float]$SourceSizeGB + 1) {
    Write-Host "[ERREUR] Pas assez d'espace libre sur `$TargetDrive` !" -ForegroundColor Red
    Write-Host "Veuillez choisir un autre lecteur (C, D ou G) en modifiant le paramètre -TargetDrive" -ForegroundColor Yellow
    exit 1
}

# Créer le dossier de backup
Write-Host "[INFO] Création du dossier de sauvegarde..." -ForegroundColor White
New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
if (-not (Test-Path $BackupPath)) {
    Write-Host "[ERREUR] Impossible de créer le dossier de sauvegarde : $BackupPath" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Dossier créé : $BackupPath" -ForegroundColor Green
Write-Host ""

# Copie des fichiers importants
Write-Host "[INFO] Début de la copie..." -ForegroundColor White
$copiedItems = 0
$errors = 0

# Exclure les gros dossiers inutiles pour la sauvegarde
$Exclude = @("node_modules", ".git", "dist", ".vercel", "__pycache__", "*.log")

try {
    Get-ChildItem -Path $SourcePath -Force | ForEach-Object {
        # Vérifier si ce fichier/dossier doit être exclu
        $shouldExclude = $false
        foreach ($pattern in $Exclude) {
            if ($_.Name -like $pattern) {
                $shouldExclude = $true
                break
            }
        }

        if (-not $shouldExclude) {
            $destItem = Join-Path $BackupPath $_.Name
            try {
                Copy-Item -Path $_.FullName -Destination $destItem -Recurse -Force -ErrorAction Stop
                $copiedItems++
            } catch {
                $errors++
                Write-Host "[WARN] Échec de copie : $($_.Name) - $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "[ERREUR] Exception pendant la copie : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Résumé
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sauvegarde terminée !" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[OK] Chemin de sauvegarde : $BackupPath" -ForegroundColor Green
Write-Host "[OK] Fichiers copiés : $copiedItems" -ForegroundColor Green
if ($errors -gt 0) {
    Write-Host "[!] Erreurs : $errors" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "CONSEIL : Copiez aussi ce dossier sur une clé USB pour plus de sécurité." -ForegroundColor Cyan
Write-Host ""
