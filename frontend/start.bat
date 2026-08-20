@echo off
chcp 65001 >nul
cd /d C:\25122068\AI_Challenge
call venv\Scripts\activate

echo Dang kiem tra thu vien...
pip install pillow deep-translator --quiet --disable-pip-version-check

start /min cmd /k "cd /d C:\25122068\AI_Challenge && venv\Scripts\activate && uvicorn app:app --reload --port 8000"
timeout /t 5 /nobreak >nul
start /min cmd /k "cd /d C:\25122068\AI_Challenge\frontend && python -m http.server 5173"
timeout /t 2 /nobreak >nul
start http://localhost:5173