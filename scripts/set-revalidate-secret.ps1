# Creates a random REVALIDATE_SECRET (64 hex characters) without showing it:
# - sets the GitHub secret REVALIDATE_SECRET, used by the pipeline
# - adds or replaces REVALIDATE_SECRET in .env.local (gitignored), where you
#   copy it from into Vercel (Settings > Environment Variables, Production)
# Run it again to rotate the secret, then update Vercel and redeploy.
#
# Usage, from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/set-revalidate-secret.ps1
param(
  [string]$Repo = "phongtran72/top10-trends"
)
$ErrorActionPreference = "Stop"

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })

$secret | gh secret set REVALIDATE_SECRET --repo $Repo
if ($LASTEXITCODE -ne 0) { throw "gh secret set failed." }

$path = Join-Path (Get-Location) ".env.local"
$lines = @()
if (Test-Path $path) {
  $lines = @([IO.File]::ReadAllLines($path) | Where-Object { $_ -notmatch '^REVALIDATE_SECRET=' })
}
$lines += "REVALIDATE_SECRET=$secret"
# UTF-8 without a byte-order mark, which Node's env-file parser would misread.
[IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))

Write-Host "Done: set REVALIDATE_SECRET on $Repo and in .env.local."
Write-Host "For Vercel, copy the value after REVALIDATE_SECRET= in .env.local."
