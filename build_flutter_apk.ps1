# بناء تطبيق الجوال (Flutter) — APK + Web
# الاستخدام:  powershell -ExecutionPolicy Bypass -File .\build_flutter_apk.ps1
# الخيارات:   .\build_flutter_apk.ps1 -SkipTests
#             .\build_flutter_apk.ps1 -ApiUrl "https://your-server.onrender.com"
#             .\build_flutter_apk.ps1 -WebOnly

param(
  [string]$ApiUrl = "https://alghith-laundry.onrender.com",
  [switch]$SkipTests,
  [switch]$WebOnly
)

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Project = Join-Path $Root "laundry_mobile_project"
$OutDir = Join-Path $Root "apk"
$Flutter = "D:\ali\flutter\bin\flutter.bat"

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Write-Host "==> التحقق من الأدوات" -ForegroundColor Cyan
if (-not (Test-Path $Flutter)) { throw "لم يُعثر على Flutter في: $Flutter" }
if (-not $WebOnly) {
  if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "JAVA_HOME غير صحيح: $env:JAVA_HOME" }
  $SdkDir = Join-Path $env:LOCALAPPDATA "Android\Sdk"
  if (-not (Test-Path $SdkDir)) { throw "لم يُعثر على Android SDK في: $SdkDir" }
  $sdkProp = "sdk.dir=" + ($SdkDir -replace '\\', '\\' -replace ':', '\:')
  Set-Content -LiteralPath (Join-Path $Project "android\local.properties") -Value $sdkProp -Encoding ascii
  Write-Host "    Flutter: $Flutter"
  Write-Host "    Java   : $env:JAVA_HOME"
  Write-Host "    SDK    : $SdkDir"
}
Write-Host "    API    : $ApiUrl"

Push-Location $Project
try {
  Write-Host "==> جلب الحزم" -ForegroundColor Cyan
  & $Flutter pub get
  if ($LASTEXITCODE -ne 0) { throw "فشل جلب الحزم." }

  if (-not $SkipTests) {
    Write-Host "==> الفحص والتشغيل" -ForegroundColor Cyan
    & $Flutter analyze
    if ($LASTEXITCODE -ne 0) { throw "فشل الفحص — تم إيقاف البناء." }
    & $Flutter test
    if ($LASTEXITCODE -ne 0) { throw "فشل الاختبارات — تم إيقاف البناء." }
  }

  Write-Host "==> بناء نسخة Web" -ForegroundColor Cyan
  & $Flutter build web --release --dart-define=LAUNDRY_API_BASE_URL=$ApiUrl
  if ($LASTEXITCODE -ne 0) { throw "فشل بناء Web." }

  if (-not $WebOnly) {
    Write-Host "==> بناء نسخة Android (Release)" -ForegroundColor Cyan
    & $Flutter build apk --release --dart-define=LAUNDRY_API_BASE_URL=$ApiUrl
    if ($LASTEXITCODE -ne 0) { throw "فشل بناء APK." }
  }
} finally {
  Pop-Location
}

if (-not $WebOnly) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  Copy-Item (Join-Path $Project "build\app\outputs\flutter-apk\app-release.apk") (Join-Path $OutDir "laundry-mobile-v1.0-release.apk") -Force
}

Write-Host "`n==> تم البناء." -ForegroundColor Green
if (-not $WebOnly) {
  Get-ChildItem $OutDir -Filter *.apk | ForEach-Object {
    "{0,-38} {1} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2)
  }
}
Write-Host ("Web: " + (Join-Path $Project "build\web"))
