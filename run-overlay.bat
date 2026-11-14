@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem "hidden" = started by run-overlay.vbs with no window: no pause on error (nobody could press a key)
if /i "%~1"=="hidden" set HIDDEN=1
set ELECTRON=node_modules\electron\dist\electron.exe

echo [1/5] Node.js 확인...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치돼 있지 않습니다. https://nodejs.org 에서 20.12 이상을 설치하세요.
  goto :fail
)
node -v

rem Already running: don't rebuild or reinstall under a live app, just bring the overlay forward
curl -s -m 2 http://127.0.0.1:3001/api/health >nul 2>nul
if not errorlevel 1 (
  echo 이미 실행 중입니다. 오버레이를 앞으로 가져옵니다.
  if exist "%ELECTRON%" start "" "%ELECTRON%" overlay
  goto :eof
)

echo.
echo [2/5] 최신 코드 받기 (git pull origin main)...
git pull --ff-only origin main
if errorlevel 1 echo git pull 실패. 인터넷 연결이나 로컬 수정 사항을 확인하세요. 지금 코드로 계속 실행합니다.

echo.
echo [3/5] 의존성 확인...
node scripts\needs-install.cjs
if errorlevel 1 (
  echo 변경 없음. 설치를 건너뜁니다.
) else (
  echo package-lock.json이 바뀌어서 npm install을 실행합니다.
  call npm install
  if errorlevel 1 (
    echo npm install 실패.
    goto :fail
  )
  node scripts\needs-install.cjs --mark
)

echo.
echo [4/5] 빌드 (오버레이 화면 + 서버 번들)...
call npm run build -w web
if errorlevel 1 goto :fail
call npm run bundle -w server
if errorlevel 1 goto :fail

echo.
echo [5/5] 오버레이 실행...
if not exist "%ELECTRON%" (
  echo Electron이 없습니다. npm install을 다시 실행하세요.
  goto :fail
)
rem Start Electron on its own and exit: no npm/cmd/wscript processes stay behind while you play.
rem Electron starts the coach server itself and restarts it if it ever stops.
start "" "%ELECTRON%" overlay
echo 시작됨.

endlocal
exit /b 0

:fail
echo.
echo 실행 중 오류가 발생했습니다.
if not defined HIDDEN pause
endlocal
exit /b 1
