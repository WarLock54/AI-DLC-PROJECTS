# Sandbox Yenileme Rehberi (8 saatlik AWS sandbox)

Sandbox süresi dolduğunda **AWS'deki tüm kaynaklar silinir**, ama projenin ilerlemesi kaybolmaz.
Bu rehber, yeni sandbox geldiğinde sadece credential'ları girerek kaldığımız yerden devam etmeyi anlatır.

## Ne kaybolur, ne kalır?

| Ne | Sandbox bitince | Nasıl korunur |
|---|---|---|
| AI-DLC ilerlemesi (`aidlc/`: kararlar, belgeler, akış durumu) | Etkilenmez | Her aşama onayından sonra commit + push |
| Kod, IaC, pipeline (`infra/`, `app/`, `.gitlab-ci.yml`) | Etkilenmez | Git |
| AWS kaynakları (DynamoDB, Lambda, S3, CloudFront, Cognito…) | **Silinir** | Kurtarılmaz; pipeline her yeni hesapta sıfırdan kurar |
| GitLab CI/CD değişkenleri | Eski değerler geçersiz olur | `scripts/sandbox-login.ps1` ile güncellenir |
| Yerel AWS profili (`team32-sandbox`) | Eski değerler geçersiz olur | `scripts/sandbox-login.ps1` ile güncellenir |

## Yeni sandbox geldiğinde (yaklaşık 5 dk)

1. Sandbox sayfasında **Start task**, ardından credential'ları göster.
2. Repo kök dizininde:
   ```powershell
   . .\scripts\sandbox-login.ps1
   ```
   Access key, secret ve session token'ı yapıştır. Script yerel profili ve GitLab değişkenlerini günceller, sonra `sts get-caller-identity` ile doğrular.
3. Altyapıyı yeniden kur (C1 tamamlandıktan sonra):
   - GitLab → Build → Pipelines → `main` için **Run pipeline**, ya da
   - yerelde `npx cdk bootstrap` ve ardından `npx cdk deploy --all`
4. Gerekirse Copilot'u **bu terminalden** yeniden aç (`codemie-copilot`), böylece AWS komutları sandbox profilini kullanır.

## Altyapı kodunun uyması gereken kurallar (C1 kabul kriterlerine eklendi)

Credential'ları girmek tek başına yetmez; kod boş bir hesapta sorunsuz kurulabilmelidir.

- `cdk bootstrap` pipeline'ın ilk deploy adımında çalışır (tekrar çalışması zararsızdır).
- Hesap ID, bölge, URL, bucket adı **sabit yazılmaz**; bölge `AWS_DEFAULT_REGION`'dan, diğer değerler stack çıktılarından okunur.
- Terraform kullanılmadığı için uzak state gerekmez (CDK, CloudFormation ile durumu hesabın içinde tutar).
- Test verisi (seed) pipeline'da eklenir ve tekrar çalıştırıldığında kopya oluşturmaz.
- Konsoldan **elle hiçbir şey** yapılmaz; elle yapılan her şey sandbox bitince kaybolur.
- SES adres doğrulaması sadece debug sandbox'ta, kanıt için yapılır; normal çalışma `EMAIL_MODE=log` ile olur.

## Final doğrulamadan önce kontrol listesi

- [ ] GitLab'da **`AWS_SESSION_TOKEN` değişkeni silindi.** Orkestratör sadece `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` değişkenlerinin üzerine yazar. Eski bir session token kalırsa pipeline `InvalidClientTokenId` hatasıyla düşer. (`sandbox-login.ps1` token girilmediğinde bu değişkeni siler.)
- [ ] Pipeline, temiz bir sandbox'ta elle müdahale olmadan en az bir kez başarıyla (exit 0) çalıştı.
- [ ] Pipeline iki kez üst üste çalıştırıldığında kaynak çoğaltmadan başarılı oluyor.

## Güvenlik

- Credential'lar sohbetlere, AI ajanlarına, koda veya commit'lere yapıştırılmaz.
- Script değerleri ekrana yazmaz ve sadece `~/.aws` profiline kaydeder.
- GitLab kişisel erişim token'ı (`api` yetkili) kaydedilmez; script her seferinde sorar.
- Bölge yalnızca sandbox sözleşmesindeki üç bölgeden biri olabilir: `us-east-1`, `eu-west-1`, `ap-south-1` (script başka bölgeyi reddeder).

## Bilinen sorun: Windows + Copilot CLI'da AI-DLC dosya yazma kayıtları

Windows'ta Copilot CLI, AI-DLC'nin PostToolUse hook'unu tetiklemiyor. Bu yüzden aşama belgeleri diskte olsa da audit kaydında "yazıldı" görünmüyor ve onay kapısı açılmıyor.
Geçici çözüm: aşama onayından sonra yazılan çıktı belgeleri için, ayrı bir terminalde, AI-DLC'nin kendi hook komutuyla kayıt eklenir:

```powershell
$env:AIDLC_PROJECT_DIR = (Get-Location).Path
'{"hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"<belgenin tam yolu, / ile>"}}' | aidlc engine hook write-audit-log
Remove-Item Env:AIDLC_PROJECT_DIR
```

Ardından Copilot'a "writes are recorded; open the approval gate again" denir. Soru dosyaları ve `memory.md` için kayıt eklenmez; sadece onaydan sonra üretilen çıktı belgeleri için eklenir.
