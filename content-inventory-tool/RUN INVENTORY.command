#!/bin/bash
# Content Inventory Tool — clickable launcher
# Double-click this file to start the server and open the dashboard

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Activate venv if present
if [ -d "venv/bin" ]; then
  source venv/bin/activate
fi

# Open browser after short delay
sleep 1.5 && open http://localhost:4100 &

echo "──────────────────────────────────────────────"
echo "  Content Inventory Tool"
echo "  http://localhost:4100"
echo "──────────────────────────────────────────────"

python3 inventory_server.py
