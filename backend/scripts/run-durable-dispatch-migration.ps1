# SkillQuest - Lanceur securise de verification et application de la migration durable_dispatch
#
# Modes d'utilisation :
#   1. Validation locale seule (hors-ligne, 0 appel reseau) :
#      .\backend\scripts\run-durable-dispatch-migration.ps1 -CheckLocal
#
#   2. Verification en lecture seule de Neon production (sans modification) :
#      .\backend\scripts\run-durable-dispatch-migration.ps1 -CheckRemote
#
#   3. Application securisee sur Neon production (uniquement apres autorisation distincte) :
#      .\backend\scripts\run-durable-dispatch-migration.ps1 -Apply

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [switch]$CheckLocal,

    [Parameter(Mandatory = $false)]
    [switch]$CheckRemote,

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [string]$DirectUrl = $env:NEON_DIRECT_URL
)

$ErrorActionPreference = "Stop"

$EXACT_HOST = "ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech"
$EXACT_DB = "neondb"
$REQUIRED_ROLE = "neondb_owner"
$FORBIDDEN_ROLE = "skillquest_runtime"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SKILLQUEST - MIGRATION 20261107000100_DURABLE_DISPATCH" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$scriptCjs = Join-Path $PSScriptRoot "durable-dispatch-migration.cjs"

# -------------------------------------------------------------------------
# 1. VALIDATION LOCALE PURE (-CheckLocal ou par defaut)
# -------------------------------------------------------------------------
if ($CheckLocal -or (!$CheckRemote -and !$Apply)) {
    Write-Host "`n[MODE CHECK-LOCAL] Verification des empreintes SHA-256 locales..." -ForegroundColor Yellow
    & node $scriptCjs --check-local
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Echec de la verification locale des migrations."
        exit 1
    }
    Write-Host "`n[SUCCES] 22 migrations de base + migration cible validees localement." -ForegroundColor Green
    if (!$CheckRemote -and !$Apply) {
        Write-Host "Pour inspecter Neon en lecture seule : .\backend\scripts\run-durable-dispatch-migration.ps1 -CheckRemote" -ForegroundColor Gray
        exit 0
    }
}

# -------------------------------------------------------------------------
# 2. OBTENTION SECURISEE DE L'URL DIRECTE
# -------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($DirectUrl)) {
    Write-Host "`nEntrez la chaine de connexion directe Neon (invite masquee) :" -ForegroundColor Yellow
    Write-Host "Format attendu : postgresql://ROLE:PASSWORD@$EXACT_HOST/$EXACT_DB?sslmode=verify-full" -ForegroundColor DarkGray
    $securePass = Read-Host -AsSecureString "Neon Direct URL"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
    $DirectUrl = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($DirectUrl)) {
    Write-Error "URL de connexion Neon obligatoire."
    exit 1
}

$DirectUrl = $DirectUrl.Trim().Trim('"').Trim("'")

# -------------------------------------------------------------------------
# 3. VERIFICATION LECTURE SEULE (-CheckRemote)
# -------------------------------------------------------------------------
if ($CheckRemote) {
    Write-Host "`n[MODE CHECK-REMOTE] Verification en LECTURE SEULE de Neon production..." -ForegroundColor Yellow
    $output = $DirectUrl | & node $scriptCjs --check-remote 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        Write-Error "Verification Neon distante echouee. Consultez le diagnostic securise ci-dessus."
        exit 1
    }
    Write-Host "`n[SUCCES] La base Neon de production contient exactement les 22 migrations historiques et est PRETE pour 20261107000100_durable_dispatch." -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------------
# 4. APPLICATION DE LA MIGRATION (-Apply)
# -------------------------------------------------------------------------
if ($Apply) {
    Write-Host "`n[ATTENTION] Vous allez appliquer 20261107000100_durable_dispatch sur NEON PRODUCTION." -ForegroundColor Magenta
    Write-Host "Branche cible : production | Base : $EXACT_DB | Hote : $EXACT_HOST" -ForegroundColor Yellow
    
    $confirm = Read-Host "Confirmez-vous l'execution ? (tapez 'APPLY' pour continuer)"
    if ($confirm -ne "APPLY") {
        Write-Warning "Operation annulee par l'utilisateur."
        exit 0
    }

    Write-Host "`n[APPLICATION] Execution de prisma migrate deploy sur Neon..." -ForegroundColor Yellow
    $output = $DirectUrl | & node $scriptCjs --apply 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        Write-Error "Echec de l'application de la migration distante. Consultez le diagnostic ci-dessus."
        exit 1
    }
    Write-Host "`n[SUCCES TOTAL] Migration appliquee et post-controles 100% valides sur Neon production." -ForegroundColor Green
    exit 0
}

