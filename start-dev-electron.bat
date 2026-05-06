@echo off
chcp 65001 >nul
echo ========================================
echo   Electron 后端调试模式
echo ========================================
echo.
echo 正在启动...

echo.
echo 提示：按 Ctrl+C 可停止所有进程
echo ========================================
echo.

cd /d "%~dp0"

:: 检查并终止占用3000端口的进程
echo [1/2] 检查端口3000占用情况...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo   发现占用端口3000的进程 PID: %%a
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo   警告: 无法终止进程 %%a，可能需要管理员权限
    ) else (
        echo   已终止进程 %%a
    )
)
echo   端口检查完成
echo.

:: 启动调试模式
echo [2/2] 启动Electron应用...
npm run dev:electron

pause
