# بناء ملف APK لتطبيق المغسلة (Android) — Capacitor + Gradle
# الاستخدام:  powershell -ExecutionPolicy Bypass -File .\build_apk.ps1
# الخيارات:   .\build_apk.ps1 -ReleaseOnly   (يبني نسخة الإصدار فقط)
#             .\build_apk.ps1 -SkipTests     (يتخطى الاختبارات)

param(
  [switch]$ReleaseOnly,
  [switch]$SkipTests
)

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Mobile = Join-Path $Root "mobile"
$Android = Join-Path $Mobile "android"
$OutDir = Join-Path $Root "apk"

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Write-Host "==> التحقق من الأدوات" -ForegroundColor Cyan
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "JAVA_HOME غير صحيح: $env:JAVA_HOME" }
$SdkDir = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $SdkDir)) { throw "لم يُعثر على Android SDK في: $SdkDir" }
$sdkProp = "sdk.dir=" + ($SdkDir -replace '\\', '\\' -replace ':', '\:')
Set-Content -LiteralPath (Join-Path $Android "local.properties") -Value $sdkProp -Encoding ascii
Write-Host "    Java : $env:JAVA_HOME"
Write-Host "    SDK  : $SdkDir"

if (-not $SkipTests) {
  Write-Host "==> تشغيل اختبارات التطبيق" -ForegroundColor Cyan
  Push-Location $Mobile
  try { & node test\mobile_test.mjs } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "فشل الاختبار — تم إيقاف البناء." }
}

Write-Host "==> مزامنة الملفات مع مشروع Android" -ForegroundColor Cyan
Push-Location $Mobile
try { & npx cap sync android } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "فشلت مزامنة Capacitor." }

Push-Location $Android
try {
  if ($ReleaseOnly) {
    Write-Host "==> بناء نسخة الإصدار (موقّعة)" -ForegroundColor Cyan
    & .\gradlew.bat assembleRelease --no-daemon
  } else {
    Write-Host "==> بناء نسخة التطوير والإصدار" -ForegroundColor Cyan
    & .\gradlew.bat assembleDebug assembleRelease --no-daemon
  }
  $gradleExit = $LASTEXITCODE
} finally { Pop-Location }
if ($gradleExit -ne 0) { throw "فشل بناء Gradle (رمز الخروج $gradleExit)." }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item (Join-Path $Android "app\build\outputs\apk\debug\app-debug.apk") (Join-Path $OutDir "laundry-mobile-v1.0-debug.apk") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Android "app\build\outputs\apk\release\app-release.apk") (Join-Path $OutDir "laundry-mobile-v1.0-release.apk") -Force

Write-Host "`n==> تم البناء. الملفات في: $OutDir" -ForegroundColor Green
Get-ChildItem $OutDir -Filter *.apk | ForEach-Object {
  "{0,-38} {1} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2)
}
