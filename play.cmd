@echo off
REM 더블클릭하면 시그널링+웹 서버를 띄우고 LAN 주소로 브라우저를 엽니다.
cd /d "%~dp0"
call npm run play
pause
