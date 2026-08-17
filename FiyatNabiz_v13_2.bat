@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ==============================================
echo       FiyatNabiz v13.3 - REEF KEY DUZELTILDI
echo ==============================================
echo Klasor: %CD%
echo.

if not exist "%~dp0.env" if not exist "%~dp0config\.env" (
  echo REEF_KEY= > "%~dp0.env"
  echo PORT=3000 >> "%~dp0.env"
  echo REEF_MAX_PAGES=1 >> "%~dp0.env"
  echo SCAN_INTERVAL_MINUTES=60 >> "%~dp0.env"
  echo SCAN_CATEGORIES_PER_CYCLE=12 >> "%~dp0.env"
  echo.
  echo .env dosyasi olusturuldu.
  echo REEF_KEY= satirinin sonuna ReefAPI anahtarinizi yazin.
  start "" notepad "%~dp0.env"
  echo.
  echo Kaydedip bu BAT dosyasini tekrar calistirin.
  pause
  exit /b 0
)

set "REEF_VALUE="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"REEF_KEY=" "%~dp0.env" 2^>nul`) do set "REEF_VALUE=%%B"
if not defined REEF_VALUE if exist "%~dp0config\.env" for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"REEF_KEY=" "%~dp0config\.env" 2^>nul`) do set "REEF_VALUE=%%B"
if not defined REEF_VALUE if defined REEF_KEY set "REEF_VALUE=%REEF_KEY%"
if not defined REEF_VALUE if defined REEF_API_KEY set "REEF_VALUE=%REEF_API_KEY%"

if not defined REEF_VALUE (
  echo.
  echo UYARI: ReefAPI anahtari bulunamadi.
  echo .env veya config\.env icindeki REEF_KEY= satirini kontrol edin.
  start "" notepad "%~dp0.env"
  pause
  exit /b 1
)

echo ReefAPI anahtari bulundu. Sunucu baslatiliyor...

if not exist node_modules (
  echo Ilk kurulum: npm paketleri indiriliyor...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install basarisiz oldu. Node.js kurulu mu kontrol edin.
    pause
    exit /b 1
  )
)

if not exist data mkdir data

echo ReefAPI anahtari bulundu.
echo Sunucu baslatiliyor: http://127.0.0.1:3000
echo.
start "FiyatNabiz v13.3" "http://127.0.0.1:3000"
node server.js
pause
