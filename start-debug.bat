@echo off
chcp 65001 >nul
echo ========================================
echo   Electron 后端调试模式
echo ========================================
echo.
echo 正在启动...
echo   - 后端：热重载模式 (ts-node-dev)
echo   - 前端：使用编译后的文件
echo   - DevTools：自动打开
echo.
echo 提示：按 Ctrl+C 可停止所有进程
echo ========================================
echo.

cd /d "%~dp0"

:: 启动调试模式
npm run dev:electron:prod-frontend

pause
