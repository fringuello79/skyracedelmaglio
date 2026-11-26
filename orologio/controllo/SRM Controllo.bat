@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
title SRM Controllo
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY goto nopython

%PY% -c "import meshtastic, yaml, esptool, serial" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Preparo il programma: solo la prima volta, un minuto...
  %PY% -m pip install --disable-pip-version-check --upgrade meshtastic pyyaml esptool
)

set "APP=%~dp0programma\orologio\controllo\controllo.py"
if exist "%~dp0controllo.py" set "APP=%~dp0controllo.py"

rem avvio senza finestra nera: il programma si usa dal browser e si chiude dal suo pulsante
set "PYW="
for /f "usebackq delims=" %%i in (`%PY% -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"`) do set "PYW=%%i"
if exist "%PYW%" (
  start "" "%PYW%" "%APP%"
) else (
  start "SRM Controllo" /min %PY% "%APP%"
)
exit /b 0

:nopython
echo.
echo  Python non e' installato. Installalo da https://www.python.org/downloads/
echo  (spunta "Add python.exe to PATH") e rilancia questo file.
pause
exit /b 1
