@echo off
setlocal

set ROOT=%~dp0
set DATA_DIR=%APPDATA%\TokenGame\data
set PORT=3001

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

set TOKEN_GAME_DATA_DIR=%DATA_DIR%

start "" http://127.0.0.1:%PORT%/
"%ROOT%runtime\node.exe" "%ROOT%apps\server\dist\cli.cjs"
