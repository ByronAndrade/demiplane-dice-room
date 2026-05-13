@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-DiceRoomRelay-Windows.ps1" -OriginalScriptDir "%~dp0"
echo.
echo Se a janela fechou por erro, copie a mensagem acima.
pause
