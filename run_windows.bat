@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ================================================
echo   نظام مغسلة الشركة - Al Ghaith Laundry System
echo ================================================

where py >nul 2>nul
if errorlevel 1 (
  echo لم يتم العثور على Python Launcher. ثبت Python 3.11 او احدث مع تفعيل Add Python to PATH.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/4] انشاء بيئة Python...
  py -3 -m venv .venv
  if errorlevel 1 goto :fail
)

echo [2/4] تثبيت متطلبات النظام (يحتاج اتصال انترنت اول مرة)...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :fail

echo [3/4] استيراد كشف الموظفين من ملف Excel (يُتخطى اذا سبق الاستيراد)...
".venv\Scripts\python.exe" import_employees.py --dry-run >nul 2>nul
".venv\Scripts\python.exe" import_employees.py

echo [4/4] تشغيل النظام على http://127.0.0.1:5505
echo لا تغلق هذه النافذة اثناء الاستخدام. اضغط Ctrl+C لايقاف النظام.
start "" http://127.0.0.1:5505
".venv\Scripts\python.exe" app.py
pause
exit /b 0

:fail
echo فشل التشغيل. تحقق من تثبيت Python والاتصال بالانترنت ثم حاول مجدداً.
pause
exit /b 1
