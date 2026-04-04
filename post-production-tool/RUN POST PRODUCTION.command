#!/bin/bash
# Post Production Tool — clickable launcher

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ -d "venv/bin" ]; then source venv/bin/activate; fi

sleep 1.5 && open http://localhost:4200 &

echo "──────────────────────────────────────────────"
echo "  Post Production Tool"
echo "  http://localhost:4200"
echo "──────────────────────────────────────────────"

python3 post_server.py
