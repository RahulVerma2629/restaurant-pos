@echo off
cd /d "%~dp0"
if not exist .venv ( python -m venv .venv )
call .venv\Scripts\activate
pip install -q -r requirements.txt
set AUTO_SEED=1
echo.
echo  Open in browser:  http://localhost:8000      (API docs: http://localhost:8000/docs)
echo  Stop with Ctrl+C
echo.
python -m uvicorn app.main:app --port 8000
