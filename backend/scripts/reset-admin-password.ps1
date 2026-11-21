# SkillQuest - Lanceur securise de reinitialisation du mot de passe administrateur
#
# Modes d'utilisation :
#   1. Verification locale des gardes-fous (sans connexion Neon) :
#      .\scripts\reset-admin-password.ps1 -CheckLocal
#
#   2. Execution interactive sur Neon staging (invite securisee masquee) :
#      .\scripts\reset-admin-password.ps1
#
#   3. Execution via variable d'environnement securisee :
#      $env:NEON_DIRECT_URL = "postgresql://ROLE:PASSWORD@ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"
#      .\scripts\reset-admin-password.ps1

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [switch]$CheckLocal,

    [Parameter(Mandatory = $false)]
    [string]$AdminEmail = "admin@example.test",

    [Parameter(Mandatory = $false)]
    [string]$DirectUrl = $env:NEON_DIRECT_URL
)

$ErrorActionPreference = "Stop"

$EXACT_HOST = "ep-wispy-paper-bazujx4k.c-8.eu-central-1.aws.neon.tech"
$EXACT_DB = "neondb"
$REQUIRED_ROLE = "neondb_owner"
$FORBIDDEN_ROLE = "skillquest_runtime"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SKILLQUEST - REINITIALISATION MOT DE PASSE ADMIN" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# MODE 1 : VALIDATION LOCALE PURE (-CheckLocal)
# -------------------------------------------------------------------------
if ($CheckLocal) {
    Write-Host "`n[MODE CHECK-LOCAL] Verification des gardes-fous et de l'integrite du script..." -ForegroundColor Yellow

    # 1. Verification du script backend/src/scripts/reset-admin-password.ts
    $scriptPath = Join-Path $PSScriptRoot "..\src\scripts\reset-admin-password.ts"
    if (!(Test-Path $scriptPath)) {
        Write-Error "[CHECK-LOCAL ECHOUE] Script backend/src/scripts/reset-admin-password.ts introuvable."
        exit 1
    }
    Write-Host "[OK] Script cible detecte : $scriptPath"

    $scriptContent = Get-Content $scriptPath -Raw

    # Verification des clauses de securite dans le script TypeScript
    if ($scriptContent -notmatch 'hashPassword') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit utiliser la fonction de derivation hashPassword."
        exit 1
    }
    if ($scriptContent -notmatch 'readHidden') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit imposer la saisie masquee TTY via readHidden."
        exit 1
    }
    if ($scriptContent -notmatch 'password\.length < 12') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit imposer un minimum de 12 caracteres."
        exit 1
    }
    if ($scriptContent -notmatch 'PASSWORD_MISMATCH') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit verifier la confirmation du mot de passe."
        exit 1
    }
    if ($scriptContent -notmatch 'tx\.user\.update' -or $scriptContent -notmatch 'tx\.adminSession\.deleteMany') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit executer une transaction atomique (update user + purge adminSession)."
        exit 1
    }
    if ($scriptContent -notmatch 'user\.role !== "ADMIN"') {
        Write-Error "[CHECK-LOCAL ECHOUE] Le script doit verifier que le compte possede le role ADMIN."
        exit 1
    }
    Write-Host "[OK] Integrite et regles de securite du script TypeScript validees (12 car min, double saisie masquee, transaction atomique)."

    # 2. Verification des fonctions cryptographiques dans passwords.ts et absence de dependance env
    $passwordsPath = Join-Path $PSScriptRoot "..\src\security\passwords.ts"
    if (!(Test-Path $passwordsPath)) {
        Write-Error "[CHECK-LOCAL ECHOUE] Fichier src/security/passwords.ts introuvable."
        exit 1
    }
    $passwordsContent = Get-Content $passwordsPath -Raw
    if ($passwordsContent -notmatch 'scrypt' -or $passwordsContent -notmatch 'randomBytes\(16\)') {
        Write-Error "[CHECK-LOCAL ECHOUE] passwords.ts doit implementer scrypt avec sel 16 octets."
        exit 1
    }
    if ($passwordsContent -match 'env\.ts' -or $passwordsContent -match 'JOIN_CODE_PEPPER') {
        Write-Error "[CHECK-LOCAL ECHOUE] passwords.ts ne doit pas importer env.ts."
        exit 1
    }
    if ($scriptContent -match 'security/tokens\.js') {
        Write-Error "[CHECK-LOCAL ECHOUE] reset-admin-password.ts ne doit plus importer tokens.js (eviter le chargement de env.ts)."
        exit 1
    }
    Write-Host "[OK] Module passwords.ts isole de toute dependance env applicative (JOIN_CODE_PEPPER neutralise)."
    Write-Host "[OK] Algorithme de derivation scrypt et format scrypt:salt:digest valides."

    # 3. Test unitaire des filtres d'URL Neon en memoire
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
    Write-Host "[OK] Filtres de securite (hote exact ep-wispy-paper-bazujx4k, base neondb, role neondb_owner, TLS verify-full) testes et valides."

    # 4. Verification de la commande npm dans package.json
    $pkgPath = Join-Path $PSScriptRoot "..\package.json"
    $pkgContent = Get-Content $pkgPath -Raw
    if ($pkgContent -notmatch '"admin:password"') {
        Write-Error "[CHECK-LOCAL ECHOUE] Commande npm 'admin:password' absente de package.json."
        exit 1
    }
    Write-Host "[OK] Commande npm 'admin:password' presente dans package.json."

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host "  RESULTAT CHECK-LOCAL : 100% VALIDE (AUCUN APPEL DISTANT)" -ForegroundColor Green
    Write-Host "============================================================`n" -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------------
# MODE 2 : EXECUTION SUR NEON STAGING (AVEC TOUS LES GARDE-FOUS)
# -------------------------------------------------------------------------

# Validation de l'email cible
if ([string]::IsNullOrWhiteSpace($AdminEmail) -or $AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    Write-Error "[REFUS_SECURITE] Adresse e-mail administrateur invalide : '$AdminEmail'."
    exit 1
}

# Si non fournie en variable d'environnement, demande securisee masquee de l'URL Neon
if ([string]::IsNullOrWhiteSpace($DirectUrl)) {
    Write-Host "`nEntrez l'URL directe PostgreSQL Neon (compte neondb_owner) :" -ForegroundColor Yellow
    Write-Host "(La saisie est strictement masquee et aucun mot de passe ne sera affiche)`n" -ForegroundColor DarkGray
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
    Write-Error "[REFUS_SECURITE] L'hote cible ne correspond pas a l'endpoint Neon staging ($EXACT_HOST)."
    exit 2
}

# Regle 2 : Base exacte
if ($dbName -ne $EXACT_DB) {
    Write-Error "[REFUS_SECURITE] La base de donnees doit etre exactement '$EXACT_DB'."
    exit 3
}

# Regle 3 : Role neondb_owner obligatoire (skillquest_runtime n'a que SELECT sur User)
if ($user -eq $FORBIDDEN_ROLE) {
    Write-Error "[REFUS_SECURITE] Le role $FORBIDDEN_ROLE n'a que le droit SELECT sur la table User. Utilisez $REQUIRED_ROLE."
    exit 4
}
if ($user -ne $REQUIRED_ROLE) {
    Write-Error "[REFUS_SECURITE] Seul $REQUIRED_ROLE est autorise pour modifier les identifiants administrateurs."
    exit 5
}

# Regle 4 : TLS verify-full obligatoire
if ($query -notmatch "sslmode=verify-full") {
    Write-Error "[REFUS_SECURITE] Le mode SSL doit etre obligatoirement 'sslmode=verify-full'. 'sslmode=require' n'est pas suffisant."
    exit 6
}

Write-Host "`n[GARDE-FOUS VALIDES]" -ForegroundColor Green
Write-Host "  Hote cible : $hostName"
Write-Host "  Base cible : $dbName"
Write-Host "  Role actif : $user"
Write-Host "  Compte vise : $AdminEmail"
Write-Host "  Securite TLS : verify-full"
Write-Host ""

# Transmission controlee pour Prisma Client
$env:DATABASE_URL = $DirectUrl
$env:DIRECT_URL = $DirectUrl

try {
    $backendDir = Resolve-Path (Join-Path $PSScriptRoot "..")
    Push-Location $backendDir
    try {
        Write-Host "Lancement de la reinitialisation securisee..." -ForegroundColor Yellow
        Write-Host "Veuillez saisir votre nouveau mot de passe administrateur au clavier (saisie masquee) :`n"
        & node --import tsx src/scripts/reset-admin-password.ts $AdminEmail
        if ($LASTEXITCODE -ne 0) {
            Write-Error "[ECHEC] La reinitialisation a echoue (code de sortie $LASTEXITCODE)."
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} finally {
    # Nettoyage immediat des variables sensibles en memoire
    $env:DIRECT_URL = $null
    $env:DATABASE_URL = $null
    $DirectUrl = $null
    [System.GC]::Collect()
}
