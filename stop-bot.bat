@echo off
title Parar Bot Promocoes
echo ========================================================
echo   Parando processos do Bot de Promocoes...
echo ========================================================

powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dist/server.js*' -or $_.Path -like '*node*' } | Stop-Process -Force"

echo.
echo [OK] Processos finalizados com sucesso.
pause
