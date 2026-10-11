<#
.SYNOPSIS
  Yeni 8 saatlik AWS sandbox'ı için credential'ları tek adımda günceller:
  yerel AWS CLI profili (team32-sandbox) + GitLab CI/CD değişkenleri.

.DESCRIPTION
  - Değerleri ekrana yazdırmaz, hiçbir dosyaya kaydetmez (sadece ~/.aws profiline yazar).
  - GitLab projesi, repo'nun "origin" adresinden otomatik bulunur.
  - Session token girilmezse GitLab'daki AWS_SESSION_TOKEN değişkeni silinir
    (final doğrulamada eski token kalırsa pipeline "InvalidClientTokenId" ile düşer).

.EXAMPLE
  . .\scripts\sandbox-login.ps1               # yerel profil + GitLab değişkenleri
  . .\scripts\sandbox-login.ps1 -SkipGitLab   # sadece yerel profil
#>
param(
  [switch]$SkipGitLab,
  [string]$Region  = "us-east-1",
  [string]$Profile = "team32-sandbox"
)

function Read-Secret([string]$Prompt) {
  $s = Read-Host $Prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$allowedRegions = @("us-east-1")
if ($allowedRegions -notcontains $Region) {
  throw "Region '$Region' sandbox sözleşmesinde izinli değil: $($allowedRegions -join ', ')"
}

$key    = (Read-Host "AWS_ACCESS_KEY_ID").Trim()
$secret = (Read-Secret "AWS_SECRET_ACCESS_KEY").Trim()
$token  = (Read-Secret "AWS_SESSION_TOKEN (yoksa Enter)").Trim()

# --- 1) Yerel AWS CLI profili ---------------------------------------------
aws configure set aws_access_key_id     $key    --profile $Profile
aws configure set aws_secret_access_key $secret --profile $Profile
aws configure set region                $Region --profile $Profile
if ($token) {
  aws configure set aws_session_token $token --profile $Profile
} else {
  # Windows PowerShell boş argümanı yutar; --% ile "" olduğu gibi geçirilir (eski token temizlenir).
  $env:SBX_PROFILE = $Profile
  aws --% configure set aws_session_token "" --profile %SBX_PROFILE%
  Remove-Item Env:SBX_PROFILE
}
$env:AWS_PROFILE = $Profile

Write-Host "`nSandbox kimliği:" -ForegroundColor Cyan
aws sts get-caller-identity --output table
if ($LASTEXITCODE -ne 0) { throw "Credential'lar geçersiz; sandbox sayfasındaki değerleri kontrol et." }

# --- 2) GitLab CI/CD değişkenleri -----------------------------------------
if (-not $SkipGitLab) {
  $origin = git remote get-url origin
  $u      = [uri]($origin -replace '\.git$', '')
  $prj    = [uri]::EscapeDataString($u.AbsolutePath.Trim('/'))
  $api    = "$($u.Scheme)://$($u.Host)/api/v4/projects/$prj/variables"
  $h      = @{ "PRIVATE-TOKEN" = (Read-Secret "GitLab personal access token (api scope)") }

  $vars = [ordered]@{
    AWS_ACCESS_KEY_ID     = $key
    AWS_SECRET_ACCESS_KEY = $secret
    AWS_DEFAULT_REGION    = $Region
  }
  if ($token) { $vars.AWS_SESSION_TOKEN = $token }

  foreach ($k in $vars.Keys) {
    $body = @{ key = $k; value = $vars[$k]; masked = ($k -ne "AWS_DEFAULT_REGION").ToString().ToLower() }
    try {
      Invoke-RestMethod -Method Put -Uri "$api/$k" -Headers $h -Body $body | Out-Null
      Write-Host "updated: $k" -ForegroundColor Green
    } catch {
      Invoke-RestMethod -Method Post -Uri $api -Headers $h -Body $body | Out-Null
      Write-Host "created: $k" -ForegroundColor Green
    }
  }
  if (-not $token) {
    try {
      Invoke-RestMethod -Method Delete -Uri "$api/AWS_SESSION_TOKEN" -Headers $h | Out-Null
      Write-Host "deleted: AWS_SESSION_TOKEN" -ForegroundColor Yellow
    } catch { }
  }
}

Remove-Variable key, secret, token -ErrorAction SilentlyContinue
Write-Host "`nHazır. Bu terminalde AWS_PROFILE=$Profile. Copilot'u bu terminalden aç." -ForegroundColor Cyan
