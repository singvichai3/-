@echo off
chcp 65001 >nul
echo ========================================
echo   อัปเดตไฟล์โปรแกรม (Sync to win-unpacked)
echo ========================================
echo.

cd /d "%~dp0"

set APP_DIR=%~dp0win-unpacked\resources\app

if not exist "%APP_DIR%" (
    echo [ERROR] ไม่พบโฟลเดอร์ win-unpacked\resources\app
    pause
    exit /b 1
)

echo [INFO] กำลังคัดลอกไฟล์ที่อัปเดต...

for %%f in (main.js renderer.js db-worker.js db.js preload.js search.js index.html package.json) do (
    copy /Y "%~dp0%%f" "%APP_DIR%\%%f" >nul
    echo   ✓ %%f
)

echo.
echo [OK] อัปเดตเสร็จสิ้น!
echo.
