# Script automatique de configuration Vercel pour TRANSORA
# Ce script lit tes variables depuis .env et les pousse sur Vercel (production + preview)
# USAGE: powershell -File setup-vercel-auto.ps1

$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process 2>$null

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TRANSORA - Vercel Env Auto Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérification prérequis
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "[ERREUR] Vercel CLI non trouvé." -ForegroundColor Red
    Write-Host "Installe-le : npm install -g vercel" -ForegroundColor Yellow
    exit 1
}

# Lit le fichier .env
$envFile = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
if (-not $envFile) {
    Write-Host "[ERREUR] Fichier .env introuvable." -ForegroundColor Red
    exit 1
}

# Parse les variables
function Get-EnvVar($name) {
    $match = [regex]::Match($envFile, "^${name}=(.+)$", 'MultiLine')
    return $match.Groups[1].Value.Trim()
}

# Récupère les valeurs depuis .env
$nodeEnv = if (Get-EnvVar "NODE_ENV") { Get-EnvVar "NODE_ENV" } else { "production" }
$jwtSecret = if (Get-EnvVar "JWT_SECRET") { Get-EnvVar "JWT_SECRET" } else { throw "JWT_SECRET manquant dans .env" }
$dbHost = Get-EnvVar "SUPABASE_DB_HOST"
$dbUser = Get-EnvVar "SUPABASE_DB_USER"
$dbPass = Get-EnvVar "SUPABASE_DB_PASSWORD"
$dbName = if (Get-EnvVar "SUPABASE_DB_NAME") { Get-EnvVar "SUPABASE_DB_NAME" } else { "postgres" }
$txPort = if (Get-EnvVar "SUPABASE_POOLER_TRANSACTION_PORT") { Get-EnvVar "SUPABASE_POOLER_TRANSACTION_PORT" } else { "6543" }
$sessionPort = if (Get-EnvVar "SUPABASE_POOLER_SESSION_PORT") { Get-EnvVar "SUPABASE_POOLER_SESSION_PORT" } else { "5432" }
$corsOrigins = Get-EnvVar "CORS_ORIGINS"
$caCertPath = Get-EnvVar "SUPABASE_DB_CA_CERT_PATH"

Write-Host "[INFO] Connexion Vercel..." -ForegroundColor White
$whoami = vercel whoami 2>&1 | Out-String
Write-Host "Connecté : $whoami" -ForegroundColor Green

$environments = @("production", "preview")

function Add-VercelEnv {
    param(
        [string]$Name,
        [string]$Value,
        [bool]$ShowOnly = $false
    )
    foreach ($env in $environments) {
        if ($ShowOnly) {
            Write-Host "  [SIMULATION] vercel env add $Name --environment $env --value '$Value'" -ForegroundColor Gray
        } else {
            echo $Value | vercel env add $Name --environment $env 2>&1 | ForEach-Object { Write-Host $_ }
        }
    }
    Write-Host "  [+] $Name ajouté pour production et preview" -ForegroundColor Green
}

Write-Host ""
Write-Host "Configuration des variables :" -ForegroundColor White
Write-Host ""

Add-VercelEnv "NODE_ENV" $nodeEnv
Add-VercelEnv "JWT_SECRET" $jwtSecret
Add-VercelEnv "SUPABASE_DB_HOST" $dbHost
Add-VercelEnv "SUPABASE_DB_USER" $dbUser
Add-VercelEnv "SUPABASE_DB_PASSWORD" $dbPass
Add-VercelEnv "SUPABASE_DB_NAME" $dbName
Add-VercelEnv "SUPABASE_POOLER_TRANSACTION_PORT" $txPort
Add-VercelEnv "SUPABASE_POOLER_SESSION_PORT" $sessionPort
Add-VercelEnv "CORS_ORIGINS" $corsOrigins
Add-VercelEnv "SUPABASE_DB_CA_CERT_PATH" $caCertPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Variables Vercel configurées !" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Prochaines étapes :" -ForegroundColor White
Write-Host "  1. Déployer : vercel --prod"
Write-Host "  2. Migrer la BDD : npm run db:migrate"
Write-Host ""
Write-Host "Variables actuelles sur Vercel (environnement 'production') :" -ForegroundColor White
vercel env ls production 2>$null
