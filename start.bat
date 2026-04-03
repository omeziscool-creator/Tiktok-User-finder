@echo off
cd /d "C:\Users\fixse\Desktop\Tiktok User finder"
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:3000"
node server.js
