@echo off
title Bot Promocoes (Telegram -> WhatsApp 24/7)
cd /d "%~dp0"
echo =======================================================
echo   Iniciando Bot de Promocoes (Telegram -> WhatsApp)
echo   Modo: 24h / 7 dias por semana com Auto-Restart
echo =======================================================

set "PATH=D:\Node;%PATH%"

:loop
echo [%date% %time%] Servidor iniciando...
node dist/server.js
echo.
echo [%date% %time%] Servidor parou. Reiniciando em 3 segundos...
timeout /t 3 /nobreak >nul
goto loop
