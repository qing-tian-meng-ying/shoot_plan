@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   未检测到 Node.js。请先安装 Node 18 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo.
echo   拍摄策划 · Shoot Plan
echo   服务地址： http://localhost:4173
echo   关闭此窗口即停止服务
echo.
start "" http://localhost:4173
node server.js
pause
