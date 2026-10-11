<#
.SYNOPSIS
  SETUP.md Adım 6 için GitLab'daki eksikleri tamamlar (tekrar çalıştırılabilir):
   1. Ideation / Inception / Construction milestone'larını oluşturur (varsa dokunmaz)
   2. Issue'ları milestone'lara bağlar: #1 -> Ideation, #2 -> Inception, #3-#9 -> Construction
   3. I2'ye "In Progress" etiketini ekler (board'daki In Progress listesi)
   4. I1'e ön koşul kontrolü yorumunu ekler (daha önce eklenmişse tekrar eklemez)
   5. İsteğe bağlı: I2'ye harcanan süreyi işler (-SpentI2 "3h")

.EXAMPLE
  .\scripts\gitlab-setup.ps1 -SpentI2 "3h"
#>
param(
  [string]$SpentI2 = "",
  [string]$InProgressLabel = "In Progress"
)

function Read-Secret([string]$Prompt) {
  $s = Read-Host $Prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$origin = git remote get-url origin
$u      = [uri]($origin -replace '\.git$', '')
$prj    = [uri]::EscapeDataString($u.AbsolutePath.Trim('/'))
$api    = "$($u.Scheme)://$($u.Host)/api/v4/projects/$prj"
$h      = @{ "PRIVATE-TOKEN" = (Read-Secret "GitLab personal access token (api scope)") }

# --- 1) Milestone'lar -----------------------------------------------------
$milestones = @{}
foreach ($title in "Ideation", "Inception", "Construction") {
  $existing = Invoke-RestMethod -Uri "$api/milestones?title=$([uri]::EscapeDataString($title))" -Headers $h
  if ($existing.Count -gt 0) {
    $milestones[$title] = $existing[0].id
    Write-Host "exists:  milestone $title" -ForegroundColor DarkGray
  } else {
    $m = Invoke-RestMethod -Method Post -Uri "$api/milestones" -Headers $h -Body @{ title = $title }
    $milestones[$title] = $m.id
    Write-Host "created: milestone $title" -ForegroundColor Green
  }
}

# --- 2) Issue -> milestone ------------------------------------------------
# String anahtarlar: OrderedDictionary'de sayı anahtar, sıra numarası gibi davranır.
$map = [ordered]@{ "1" = "Ideation"; "2" = "Inception" }
3..9 | ForEach-Object { $map["$_"] = "Construction" }
foreach ($iid in $map.Keys) {
  $t = $map[$iid]
  Invoke-RestMethod -Method Put -Uri "$api/issues/$iid" -Headers $h -Body @{ milestone_id = $milestones[$t] } | Out-Null
  Write-Host "issue #$iid -> $t" -ForegroundColor Green
}

# --- 3) I2 -> In Progress -------------------------------------------------
Invoke-RestMethod -Method Put -Uri "$api/issues/2" -Headers $h -Body @{ add_labels = $InProgressLabel } | Out-Null
Write-Host "issue #2 -> label '$InProgressLabel'" -ForegroundColor Green

# --- 4) I1 ön koşul yorumu ------------------------------------------------
$marker = "Prerequisites check (Onur"
$notes  = Invoke-RestMethod -Uri "$api/issues/1/notes?per_page=100" -Headers $h
if (-not ($notes | Where-Object { $_.body -like "*$marker*" })) {
  $body = @"
Prerequisites check (Onur, Oct 1):
- Sandbox access works (temporary STS credentials via SandboxAccessRole). Region: us-east-1.
- Lambda concurrent execution limit: 400 -> sufficient for 500 concurrent users (Little's law estimate ~40 concurrent at peak); total reserved concurrency must stay <= 300.
- SES is in sandbox mode (production access: false, sending: true) -> only verified addresses can receive mail.
  Decision: real SES with a verified personal address in the debug sandbox (evidence for C5); EMAIL_MODE=log stub in the final sandbox, documented in README.
- Open point for C2: the sandbox issues temporary keys, so CI needs AWS_SESSION_TOKEN during debugging; it must be removed before the final verification (the orchestrator only overwrites the three required variables).
"@
  Invoke-RestMethod -Method Post -Uri "$api/issues/1/notes" -Headers $h -Body @{ body = $body } | Out-Null
  Write-Host "comment added to issue #1" -ForegroundColor Green
} else {
  Write-Host "exists:  comment on issue #1" -ForegroundColor DarkGray
}

# --- 5) Süre kaydı (isteğe bağlı) ------------------------------------------
if ($SpentI2) {
  Invoke-RestMethod -Method Post -Uri "$api/issues/2/add_spent_time" -Headers $h -Body @{ duration = $SpentI2 } | Out-Null
  Write-Host "issue #2 spent +$SpentI2" -ForegroundColor Green
}

Write-Host "`nTamam. I1'deki iki açık maddeyi issue sayfasından işaretlemeyi unutma." -ForegroundColor Cyan
