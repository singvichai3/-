@echo off
chcp 65001 >nul
echo ========================================
echo   ระบบรับเล่มรถ ตรอ.
echo   กำลังเริ่มต้นโปรแกรม...
echo ========================================
echo.
cd /d "%~dp0"

REM Sync latest files to win-unpacked before starting
set APP_DIR=%~dp0win-unpacked\resources\app
if exist "%APP_DIR%" (
    echo [INFO] อัปเดตไฟล์ล่าสุด...
    for %%f in (main.js renderer.js db-worker.js db.js preload.js search.js index.html package.json) do (
        copy /Y "%~dp0%%f" "%APP_DIR%\%%f" >nul 2>&1
    )
    echo [OK] อัปเดตเรียบร้อย
    echo.
)

npm run dev
pause
