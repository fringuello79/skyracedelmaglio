@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
title Configurazione orologio SRM
set "LOG=%~dp0registro.txt"
echo Configurazione orologio SRM - %date% %time% > "%LOG%"
echo.
echo  === CONFIGURAZIONE OROLOGIO SRM ===
echo  Lascia l'orologio collegato e chiudi la pagina di installazione nel browser.
echo.

set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto nopython
%PY% -c "import sys; print('Python', sys.version)" >> "%LOG%" 2>&1

echo  [1/3] Installo Meshtastic per Python (un minuto)...
%PY% -m pip install --disable-pip-version-check --upgrade meshtastic pyyaml >> "%LOG%" 2>&1
if errorlevel 1 goto errore

echo  [2/3] Preparo il canale SRM e i profili (la chiave resta nella cartella "privato")...
%PY% prepara.py --orologi 1-5 >> "%LOG%" 2>&1
if errorlevel 1 goto errore

echo  [3/3] Scrivo la configurazione sull'orologio e controllo (2-4 minuti, non staccare il cavo)...
%PY% configura.py privato\orologio-001.yaml >> "%LOG%" 2>&1
if errorlevel 1 goto errore

echo.
echo  FATTO e verificato. L'orologio ha il canale SRM.
echo FINE OK >> "%LOG%"
echo.
pause
exit /b 0

:nopython
echo NO PYTHON >> "%LOG%"
echo  Python non e' installato. Installalo da https://www.python.org/downloads/
echo  (spunta "Add python.exe to PATH") e rilancia questo file.
pause
exit /b 1

:errore
echo FINE ERRORE >> "%LOG%"
echo.
echo  Qualcosa non e' andato: il dettaglio e' in registro.txt, lo leggo io.
pause
exit /b 1
