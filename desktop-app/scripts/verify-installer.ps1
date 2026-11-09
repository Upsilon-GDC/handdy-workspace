param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$PublisherName = $env:CRM_PUBLISHER_NAME
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PublisherName)) { throw 'Set CRM_PUBLISHER_NAME to the exact certificate publisher name.' }
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
if ($signature.Status -ne 'Valid' -or !$signature.SignerCertificate) { throw "Installer signature is not valid: $($signature.Status)." }
$actualPublisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($actualPublisher -cne $PublisherName.Trim()) { throw 'Installer publisher does not match CRM_PUBLISHER_NAME.' }
$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
[PSCustomObject]@{ Installer = $installerPath; Signature = 'Valid'; Publisher = $actualPublisher; SHA256 = $hash } | ConvertTo-Json
