#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
export AUTO_SEED=1
echo
echo " Open in browser:  http://localhost:8000      (API docs: http://localhost:8000/docs)"
echo " Stop with Ctrl+C"
echo
python -m uvicorn app.main:app --port 8000
