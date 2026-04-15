@echo off
chcp 65001 >nul
echo ========================================
echo   ระบบรับเล่มรถ ตรอ.
echo   กำลังทดสอบระบบ...
echo ========================================
echo.
cd /d "%~dp0"
node test_final.js
echo.
pause
