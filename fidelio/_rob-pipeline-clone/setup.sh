#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed or not on PATH."
  exit 1
fi

PYTHON_VERSION="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "Error: Python 3.11+ is required. Found: ${PYTHON_VERSION}"
  exit 1
fi

if [ ! -d "venv" ]; then
  python3 -m venv venv
fi

source "venv/bin/activate"

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
fi

mkdir -p "${HOME}/.fidelio/cache" "${HOME}/.fidelio/thumbnails"

python -m py_compile \
  "local/start.py" \
  "local/watcher.py" \
  "local/pipeline/pass1.py"

echo
echo "Setup complete."
echo "Next steps:"
echo "Fill in your API keys in .env"
echo "Run: source venv/bin/activate"
echo "Run: python local/start.py --client dre-alexandra"

# Open the walkthrough deck in the browser
echo
echo "Opening pipeline walkthrough..."
open "${PROJECT_DIR}/deck.html" 2>/dev/null || xdg-open "${PROJECT_DIR}/deck.html" 2>/dev/null || true
