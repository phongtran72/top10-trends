# Writes RESEARCH_DATABASE_URL to .env.local from one hidden password prompt:
# the Supabase session-pooler string for the read-only research_reader role
# (SETUP.md §14). Only the research notebooks use it; it never goes to GitHub
# or Vercel. Symbols in the password are percent-encoded automatically.
#
# Usage, from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/set-research-url.ps1
param(
  [string]$ProjectRef = "gnneokzgddjawrddbfez",
  [string]$PoolerHost = "aws-0-us-east-2.pooler.supabase.com"
)
$ErrorActionPreference = "Stop"

$secure = Read-Host "research_reader password (the one set in SETUP.md §14)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $password) { throw "No password entered." }

$encoded = [Uri]::EscapeDataString($password)
$url = "postgresql://research_reader.${ProjectRef}:${encoded}@${PoolerHost}:5432/postgres"

$path = Join-Path (Get-Location) ".env.local"
$lines = @()
if (Test-Path $path) {
  $lines = @([IO.File]::ReadAllLines($path) | Where-Object { $_ -notmatch '^RESEARCH_DATABASE_URL=' })
}
$lines += "RESEARCH_DATABASE_URL=$url"
# UTF-8 without a byte-order mark, which env-file parsers would misread.
[IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))

Write-Host "Done: wrote RESEARCH_DATABASE_URL to .env.local (read-only role; not sent anywhere)."
