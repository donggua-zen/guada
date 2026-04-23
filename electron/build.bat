@echo off
REM Electron 构建脚本 (Windows)
REM 编译 Electron TypeScript 文件

echo 🔨 编译 Electron 主进程...

cd /d "%~dp0"

REM 检查是否安装了 typescript
where tsc >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未找到 tsc 命令，正在安装 TypeScript...
    npm install -g typescript
)

REM 编译 TypeScript
tsc --project tsconfig.json

if %ERRORLEVEL% EQU 0 (
    echo ✅ Electron 编译成功！
    echo 输出目录: %cd%\dist
) else (
    echo ❌ Electron 编译失败！
    exit /b 1
)
