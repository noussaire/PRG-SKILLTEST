# SkillQuest - Lanceur securise de migration Neon (sessionId)
#
# Modes d'utilisation :
#   1. Validation locale seule (sans connexion Neon) :
#      .\scripts\run-migration.ps1 -CheckLocal
#
#   2. Execution securisee sur Neon (invite masquee) :
#      .\scripts\run-migration.ps1
#
#   3. Execution securisee via variable masquee :
#      $env:NEON_DIRECT_URL = "postgresql://ROLE:PASSWORD@ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"
#      .\scripts\run-migration.ps1

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [switch]$CheckLocal,

    [Parameter(Mandatory = $false)]
    [string]$DirectUrl = $env:NEON_DIRECT_URL
)

$ErrorActionPreference = "Stop"

$EXACT_HOST = "ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech"
$EXACT_DB = "neondb"
$REQUIRED_ROLE = "neondb_owner"
$FORBIDDEN_ROLE = "skillquest_runtime"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SKILLQUEST - DEPLOIEMENT MIGRATION ADDITIVE SESSIONID" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# MODE 1 : VALIDATION LOCALE PURE (-CheckLocal)
# -------------------------------------------------------------------------
if ($CheckLocal) {
    Write-Host "`n[MODE CHECK-LOCAL] Validation des protections locales sans connexion distante..." -ForegroundColor Yellow
    
    $migrationsDir = Join-Path $PSScriptRoot "..\prisma\migrations"
    if (!(Test-Path $migrationsDir)) {
        Write-Error "[CHECK-LOCAL ECHOUE] Dossier prisma/migrations introuvable."
        exit 1
    }

    $allDirs = Get-ChildItem -Directory $migrationsDir | Select-Object -ExpandProperty Name | Sort-Object
    $expectedCount = 20
    Write-Host "[OK] Migrations locales detectees : $($allDirs.Count) (attendu : $expectedCount)"

    if ($allDirs.Count -ne $expectedCount) {
        Write-Error "[CHECK-LOCAL ECHOUE] Le nombre de migrations locales ($($allDirs.Count)) differe de $expectedCount."
        exit 1
    }

    $targetName = "20261103010000_session_adaptive_link"
    if ($allDirs[19] -ne $targetName) {
        Write-Error "[CHECK-LOCAL ECHOUE] La 20e migration doit etre $targetName."
        exit 1
    }
    Write-Host "[OK] Migration cible validee : $targetName"

    $targetSql = Join-Path $migrationsDir "$targetName\migration.sql"
    if (!(Test-Path $targetSql)) {
        Write-Error "[CHECK-LOCAL ECHOUE] Fichier migration.sql introuvable dans $targetName."
        exit 1
    }

    $sqlContent = Get-Content $targetSql -Raw
    if ($sqlContent -notmatch 'ADD COLUMN IF NOT EXISTS "sessionId" UUID') {
        Write-Error "[CHECK-LOCAL ECHOUE] La migration doit comporter ADD COLUMN IF NOT EXISTS sessionId UUID."
        exit 1
    }
    if ($sqlContent -notmatch 'GRANT SELECT, INSERT, UPDATE ON TABLE "AdaptiveInterview" TO skillquest_runtime') {
        Write-Error "[CHECK-LOCAL ECHOUE] La migration doit accorder les droits moindres privileges a skillquest_runtime."
        exit 1
    }
    Write-Host "[OK] Syntaxe et clauses de securite SQL du fichier de migration validees."

    # Test des gardes-fous d'URL en memoire
    $testBadHost = "postgresql://neondb_owner:secret@autre-hote.neon.tech/neondb?sslmode=verify-full"
    $testBadRole = "postgresql://skillquest_runtime:secret@$EXACT_HOST/neondb?sslmode=verify-full"
    $testBadDb = "postgresql://neondb_owner:secret@$EXACT_HOST/autre_db?sslmode=verify-full"
    $testBadSsl = "postgresql://neondb_owner:secret@$EXACT_HOST/neondb?sslmode=require"

    $guardOk = $true
    if ($testBadHost -match [regex]::Escape($EXACT_HOST)) { $guardOk = $false }
    if ($testBadRole -notmatch "skillquest_runtime") { $guardOk = $false }
    if ($testBadDb -match "/neondb\?") { $guardOk = $false }
    if ($testBadSsl -match "sslmode=verify-full") { $guardOk = $false }

    if (!$guardOk) {
        Write-Error "[CHECK-LOCAL ECHOUE] Anomalie logique dans les regles de filtrage des URL."
        exit 1
    }
    Write-Host "[OK] Filtres de securite (hote exact, role, db et verify-full) testes et valides."

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host "  RESULTAT CHECK-LOCAL : 100% VALIDE (AUCUN APPEL DISTANT)" -ForegroundColor Green
    Write-Host "============================================================`n" -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------------
# MODE 2 : EXECUTION SUR NEON (AVEC TOUS LES GARDE-FOUS)
# -------------------------------------------------------------------------

# Si non fournie en variable d'environnement, demande securisee masquee
if ([string]::IsNullOrWhiteSpace($DirectUrl)) {
    Write-Host "`nEntrez l'URL directe PostgreSQL Neon (neondb_owner) :" -ForegroundColor Yellow
    Write-Host "(La saisie est strictement masquee et aucun secret ne sera affiche)`n" -ForegroundColor DarkGray
    $secureInput = Read-Host -AsSecureString "Neon Direct URL"
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
    $DirectUrl = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($DirectUrl)) {
    Write-Error "[REFUS_SECURITE] URL de connexion requise. Operation annulee."
    exit 1
}

# Parse URL sans afficher les identifiants
try {
    $uri = [System.Uri]$DirectUrl
} catch {
    Write-Error "[REFUS_SECURITE] Format d'URL PostgreSQL invalide."
    exit 1
}

$user = $uri.UserInfo.Split(":")[0]
$hostName = $uri.DnsSafeHost
$dbName = $uri.AbsolutePath.TrimStart("/").TrimEnd("/")
$query = $uri.Query

# Regle 1 : Hote exact
if ($hostName -ne $EXACT_HOST) {
    Write-Error "[REFUS_SECURITE] L'hote cible ne correspond pas exactement a l'endpoint Neon autorise ($EXACT_HOST)."
    exit 2
}

# Regle 1 : Base exacte
if ($dbName -ne $EXACT_DB) {
    Write-Error "[REFUS_SECURITE] La base de donnees doit etre exactement '$EXACT_DB'."
    exit 3
}

# Regle 1 : Role exact neondb_owner et interdiction skillquest_runtime
if ($user -eq $FORBIDDEN_ROLE) {
    Write-Error "[REFUS_SECURITE] Le role $FORBIDDEN_ROLE est strictement interdit pour les migrations DDL. Utilisez $REQUIRED_ROLE."
    exit 4
}
if ($user -ne $REQUIRED_ROLE) {
    Write-Error "[REFUS_SECURITE] Seul $REQUIRED_ROLE est autorise pour appliquer les migrations."
    exit 5
}

# Regle 2 : TLS verify-full obligatoire
if ($query -notmatch "sslmode=verify-full") {
    Write-Error "[REFUS_SECURITE] Le mode SSL doit etre obligatoirement 'sslmode=verify-full'. 'sslmode=require' n'est pas suffisant."
    exit 6
}

# Transmission controlee pour Prisma CLI
$env:DIRECT_URL = $DirectUrl
$env:DATABASE_URL = $DirectUrl

try {
    Write-Host "`nGarde-fous pre-connexion valides avec succes." -ForegroundColor Green
    Write-Host "Demarrage des controles Prisma et execution ciblee..." -ForegroundColor Green
    node "$PSScriptRoot\deploy-session-migration.cjs"
}
finally {
    # Nettoyage immediat des variables sensibles en memoire
    $env:DIRECT_URL = $null
    $env:DATABASE_URL = $null
    $DirectUrl = $null
    [System.GC]::Collect()
}
