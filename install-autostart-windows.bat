@echo off
title Ativar Inicializacao Automatica 24/7
cd /d "%~dp0"

set "TARGET=%~dp0start-silent.vbs"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BotPromocoes247.lnk"

echo ========================================================
echo   Configurando Inicializacao Automatica no Windows
echo ========================================================
echo.

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET%\"'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [SUCESSO] O bot foi configurado para iniciar automaticamente com o Windows!
    echo Local do atalho: %SHORTCUT%
) else (
    echo [AVISO] Nao foi possivel criar o atalho de inicializacao.
)

echo.
pause
