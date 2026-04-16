#!/usr/bin/env bash
# deploy.sh — safe deploy for OP Hub.
#
# WHY THIS EXISTS: on 2026-04-16 a bare `railway up` deployed OP Hub code
# to a Fidelio service because the Railway CLI had drifted to the wrong
# project. The build failed (different repo structure) so no live damage,
# but a structurally-similar Node service WOULD have been overwritten.
#
# Use this script instead of `railway up`. It hard-codes the OP Hub
# project + service IDs, runs `railway link`, verifies the link landed
# on the right service, and only then runs `railway up`.
#
# Usage:  bash scripts/deploy.sh
# Or:     npm run deploy
set -euo pipefail

# OP Hub identifiers — DO NOT change these without also updating MEMORY.
EXPECTED_PROJECT_ID="2049a8ed-33ea-47bf-aee6-08056b3a16ab"
EXPECTED_SERVICE_ID="81f7e3b4-00b5-4b49-8f74-955313738a11"
EXPECTED_SERVICE_NAME="quote-assistant"
EXPECTED_PROJECT_NAME="osteoPeinture"

# Preflight: required tools must be on PATH (nvm shells sometimes drop node).
command -v railway >/dev/null || { echo "[deploy] ABORT: 'railway' CLI not found on PATH."; exit 1; }
command -v node >/dev/null    || { echo "[deploy] ABORT: 'node' not found on PATH."; exit 1; }

echo "[deploy] Linking to OP Hub (project=$EXPECTED_PROJECT_ID service=$EXPECTED_SERVICE_ID)..."
railway link \
  --project "$EXPECTED_PROJECT_ID" \
  --service "$EXPECTED_SERVICE_ID" \
  --environment production >/dev/null

# Verify the link actually landed where we expect. `railway status --json`
# returns the linked project; we cross-check the project ID. Stream stdin
# fully (chunked output is possible) and parse on 'end' to avoid silent
# JSON-parse failure on multi-chunk responses.
LINKED_PROJECT_ID=$(railway status --json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{console.log(JSON.parse(s).id||'')}catch(e){console.log('')}})")

if [ "$LINKED_PROJECT_ID" != "$EXPECTED_PROJECT_ID" ]; then
  echo "[deploy] ABORT: linked project is '$LINKED_PROJECT_ID', expected '$EXPECTED_PROJECT_ID'."
  echo "[deploy] The Railway CLI drifted. Run 'railway link' manually and re-check."
  exit 1
fi

echo "[deploy] Verified: linked to $EXPECTED_PROJECT_NAME / $EXPECTED_SERVICE_NAME"
echo "[deploy] Running railway up..."
railway up --detach
