@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Rebuilding native modules for Electron
echo ========================================

REM 设置 Electron 版本
set ELECTRON_VERSION=41.2.2
set TARGET_ARCH=x64

REM 进入 backend-ts 目录
cd /d "%~dp0backend-ts"

echo.
echo Step 1: Removing old better-sqlite3...
if exist "node_modules\better-sqlite3" (
    rmdir /s /q "node_modules\better-sqlite3"
)

echo.
echo Step 2: Installing better-sqlite3...
call npm install better-sqlite3@latest

echo.
echo Step 3: Setting up Visual Studio environment...
call "D:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat" x64

REM 确保 VCINSTALLDIR 被正确设置
echo VCINSTALLDIR=%VCINSTALLDIR%
if not defined VCINSTALLDIR (
    echo ERROR: VCINSTALLDIR not set!
    exit /b 1
)

echo.
echo Step 4: Rebuilding for Electron %ELECTRON_VERSION%...
set npm_config_target=%ELECTRON_VERSION%
set npm_config_arch=%TARGET_ARCH%
set npm_config_target_arch=%TARGET_ARCH%
set npm_config_disturl=https://electronjs.org/headers
set npm_config_runtime=electron
set npm_config_build_from_source=true

call npm rebuild better-sqlite3

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Rebuild failed!
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo SUCCESS: Native modules rebuilt!
echo ========================================
endlocal
