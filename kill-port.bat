@echo off
rem ============================================================================
rem  kill-port.bat - free up occupied dev ports (Windows)
rem
rem  Usage:
rem    kill-port.bat                 handle default port 5173 (frontend vite)
rem    kill-port.bat 3000            handle a single port
rem    kill-port.bat 5173 3000       handle multiple ports
rem    kill-port.bat --list          list who holds the port, do NOT kill
rem
rem  Notes:
rem   - Only kills processes in LISTENING state. TIME_WAIT / CLOSE_WAIT rows
rem     are finished connections that expire on their own; nothing to kill.
rem   - Prints process name + command line before killing, so you can see
rem     whether it is really your dev server.
rem   - Uses PowerShell for the command line because wmic is gone on newer
rem     Windows builds.
rem   - ASCII only on purpose: a .bat is read as the console codepage (GBK on
rem     zh-CN Windows), so UTF-8 Chinese text here would be garbled into
rem     commands.
rem ============================================================================
setlocal EnableDelayedExpansion

set "PORTS="
set "DRY=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--list" (
  set "DRY=1"
  shift
  goto parse_args
)
if /i "%~1"=="--dry" (
  set "DRY=1"
  shift
  goto parse_args
)
set "PORTS=!PORTS! %~1"
shift
goto parse_args

:args_done
if "!PORTS!"=="" set "PORTS= 5173"

echo.
echo [kill-port] target ports:!PORTS!
if "!DRY!"=="1" echo [kill-port] list only, nothing will be killed
echo.

set "FOUND=0"

for %%P in (!PORTS!) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:"LISTENING" ^| findstr ":%%P "') do (
    if not "%%A"=="0" (
      call :handle_pid %%P %%A
    )
  )
)

if "!FOUND!"=="0" (
  echo [kill-port] no process is holding the port; it is already free.
)

echo.
goto :eof

rem ---------------------------------------------------------------------------
:handle_pid
set "PORT=%~1"
set "PID=%~2"

if defined SEEN_%PID% goto :eof
set "SEEN_%PID%=1"
set "FOUND=1"

set "PNAME=?"
for /f "tokens=1 delims=," %%N in ('tasklist /FI "PID eq %PID%" /FO CSV /NH 2^>nul') do set "PNAME=%%~N"

set "PCMD="
for /f "delims=" %%C in ('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=%PID%').CommandLine" 2^>nul') do set "PCMD=%%C"

echo [kill-port] port %PORT%  ^<- PID %PID%  ^(%PNAME%)
if defined PCMD (
  set "SHOW=!PCMD!"
  if not "!SHOW:~160!"=="" set "SHOW=!SHOW:~0,160! ..."
  echo              !SHOW!
)

if "!DRY!"=="1" (
  echo              ^(list only, not killed^)
  echo.
  goto :eof
)

taskkill /PID %PID% /F >nul 2>&1
if errorlevel 1 (
  echo              [FAILED] could not kill, admin rights may be required
) else (
  echo              [KILLED]
)
echo.
goto :eof
