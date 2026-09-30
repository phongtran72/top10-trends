# Builds both Supabase pooler connection strings from one hidden password
# prompt, so the password is typed once and never shown:
# - sets the GitHub secret SESSION_DATABASE_URL (session pooler, port 5432)
# - writes .env.local (gitignored) with DATABASE_URL (transaction pooler,
#   port 6543) and SESSION_DATABASE_URL, for local runs and for copying the
#   DATABASE_URL value into Vercel.
# Symbols in the password are percent-encoded automatically.
#
# Usage, from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/set-db-secrets.ps1
param(
  [string]$Repo = "phongtran72/top10-trends",
  [string]$ProjectRef = "gnneokzgddjawrddbfez",
  [string]$PoolerHost = "aws-0-us-east-2.pooler.supabase.com"
)
$ErrorActionPreference = "Stop"

if (Test-Path ".env.local") {
  $answer = Read-Host ".env.local exists and will be replaced. Continue? (y/n)"
  if ($answer -ne "y") { exit 1 }
}

$secure = Read-Host "Supabase database password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $password) { throw "No password entered." }

$encoded = [Uri]::EscapeDataString($password)
$session = "postgresql://postgres.${ProjectRef}:${encoded}@${PoolerHost}:5432/postgres"
$transaction = "postgresql://postgres.${ProjectRef}:${encoded}@${PoolerHost}:6543/postgres"

$session | gh secret set SESSION_DATABASE_URL --repo $Repo
if ($LASTEXITCODE -ne 0) { throw "gh secret set failed." }

# UTF-8 without a byte-order mark, which Node's env-file parser would misread.
$lines = @("DATABASE_URL=$transaction", "SESSION_DATABASE_URL=$session")
[IO.File]::WriteAllLines((Join-Path (Get-Location) ".env.local"), $lines, (New-Object Text.UTF8Encoding($false)))

Write-Host "Done: set SESSION_DATABASE_URL on $Repo and wrote .env.local."
Write-Host "For Vercel, copy the value after DATABASE_URL= in .env.local."
