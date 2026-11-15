# Script de configuration automatique des variables d'environnement Vercel pour TRANSORA
# Exécuter : powershell -File config-vercel-env.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TRANSORA - Configuration Vercel Env" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Vérifier que Vercel CLI est installé
try {
    vercel --version | Out-Null
    Write-Host "[OK] Vercel CLI détecté." -ForegroundColor Green
} catch {
    Write-Host "[ERREUR] Vercel CLI non installé. Installez-le avec : npm i -g vercel" -ForegroundColor Red
    exit 1
}

# Vérifier que l'utilisateur est connecté
$whoami = vercel whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERREUR] Vous n'êtes pas connecté à Vercel. Connectez-vous avec : vercel login" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Connecté à Vercel en tant que : $whoami" -ForegroundColor Green
Write-Host ""

# Fonction pour ajouter une variable d'environnement
function Add-VercelEnvVar {
    param(
        [string]$Name,
        [string]$Prompt,
        [bool]$Required = $true
    )

    $value = Read-Host "$Prompt"

    if ([string]::IsNullOrWhiteSpace($value) -and $Required) {
        Write-Host "  [!]'$Name' est requis." -ForegroundColor Yellow
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($value)) {
        # Utiliser le stdin pour éviter les questions interactives
        $value | vercel env add $Name --scope refontiq-dotcom 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [+] '$Name' configurée sur Vercel." -ForegroundColor Green
        } else {
            Write-Host "  [~] Ajout manuel nécessaire : vercel env add $Name" -ForegroundColor Yellow
        }
    }
}

# Configuration interative
Write-Host "Veuillez entrer les valeurs suivantes :" -ForegroundColor White
Write-Host ""

Add-VercelEnvVar -Name "NODE_ENV" -Prompt "NODE_ENV (production par défaut): " -Required $false
Add-VercelEnvVar -Name "JWT_SECRET" -Prompt "JWT_SECRET (min 32 caractères, générera si vide): " -Required $true
Add-VercelEnvVar -Name "SUPABASE_DB_HOST" -Prompt "SUPABASE_DB_HOST (ex: xxx.supabase.co): " -Required $true
Add-VercelEnvVar -Name "SUPABASE_DB_USER" -Prompt "SUPABASE_DB_USER (ex: postgres.xxxx): " -Required $true
Add-VercelEnvVar -Name "SUPABASE_DB_PASSWORD" -Prompt "SUPABASE_DB_PASSWORD: " -Required $true
Add-VercelEnvVar -Name "SUPABASE_DB_NAME" -Prompt "SUPABASE_DB_NAME (postgres par défaut): " -Required $false
Add-VercelEnvVar -Name "SUPABASE_POOLER_TRANSACTION_PORT" -Prompt "SUPABASE_POOLER_TRANSACTION_PORT (6543 par défaut): " -Required $false
Add-VercelEnvVar -Name "SUPABASE_POOLER_SESSION_PORT" -Prompt "SUPABASE_POOLER_SESSION_PORT (5432 par défaut): " -Required $false
Add-VercelEnvVar -Name "CORS_ORIGINS" -Prompt "CORS_ORIGINS (ex: https://transora.example.com): " -Required $false
Add-VercelEnvVar -Name "METRICS_TOKEN" -Prompt "METRICS_TOKEN (optionnel, min 32 caractères): " -Required $false

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Configuration terminée !" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Prochaines étapes :" -ForegroundColor White
Write-Host "1. Déployer sur Vercel : vercel --prod"
Write-Host "2. Ou déployer en preview : vercel"
Write-Host "3. Appliquer les migrations : npm run db:migrate"
Write-Host ""
Write-Host "Variables actuelles sur Vercel :" -ForegroundColor White
vercel env ls --scope refontiq-dotcom 2>$null
