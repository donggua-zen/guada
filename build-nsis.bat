@echo off
chcp 65001 >nul
echo ========================================
echo   Electron NSIS 构建脚本
echo ========================================
echo.

echo [1/4] 清理旧的构建产物...
if exist release rmdir /s /q release
echo ✓ 清理完成
echo.

echo [2/4] 编译 Electron TypeScript 代码...
cd electron
call npx tsc
if errorlevel 1 (
    echo ✗ TypeScript 编译失败
    exit /b 1
)
cd ..
echo ✓ TypeScript 编译完成
echo.

echo [3/4] 编译后端代码...
cd backend-ts
call npm run build
if errorlevel 1 (
    echo ✗ 后端编译失败
    exit /b 1
)
cd ..
echo ✓ 后端编译完成
echo.

echo [4/4] 编译前端代码并打包...
cd frontend
call npm run build
if errorlevel 1 (
    echo ✗ 前端编译失败
    exit /b 1
)
cd ..
echo ✓ 前端编译完成
echo.

echo 开始 Electron 打包（NSIS）...
echo.
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set WIN_CSC_IDENTITY_AUTO_DISCOVERY=false

npx cross-env ELECTRON=true electron-builder --win nsis --x64

if errorlevel 1 (
    echo.
    echo ✗ 打包失败
    exit /b 1
) else (
    echo.
    echo ========================================
    echo   ✓ 构建成功！
    echo   安装包位置: release\AI Chat Setup *.exe
    echo ========================================
)
