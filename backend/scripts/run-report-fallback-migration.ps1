[CmdletBinding(DefaultParameterSetName = 'Local')]
param(
    [Parameter(ParameterSetName = 'Local', Mandatory = $true)][switch]$CheckLocal,
    [Parameter(ParameterSetName = 'Read', Mandatory = $true)][switch]$CheckRemote,
    [Parameter(ParameterSetName = 'Apply', Mandatory = $true)][switch]$Apply,
    [Parameter(ParameterSetName = 'Read', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Apply', Mandatory = $true)][Guid]$ExpectedStagingId,
    [Parameter(ParameterSetName = 'Read', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Apply', Mandatory = $true)]
    [ValidatePattern('^prj_[a-zA-Z0-9]+$')][string]$ExpectedProjectId
)
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'report-fallback-migration.cjs'
if ($CheckLocal) {
    & node $runner --check-local
    exit $LASTEXITCODE
}
# This path is prepared for a separately authorized operation. No URL argument,
# environment mutation, profile, network access or secret prompt in CheckLocal.
$secret = Read-Host -AsSecureString 'URL Neon directe (saisie masquee)'
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $connection = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $mode = if ($Apply) { '--apply' } else { '--check-remote' }
    $connection | & node $runner $mode $ExpectedStagingId.ToString() $ExpectedProjectId
    $result = $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $connection = $null
    $secret.Dispose()
}
exit $result
