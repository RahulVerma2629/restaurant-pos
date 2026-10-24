@echo off
cd /d "%~dp0"
if not exist .venv ( python -m venv .venv )
call .venv\Scripts\activate
pip install -q -r requirements-dev.txt
python -m pytest -q
