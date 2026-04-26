---
name: Google Sheets access method — gws CLI
description: How to read/write Google Sheets in Claude Code sessions — use gws CLI, not MCP or gspread
type: reference
---

For Claude Code sessions, use `gws sheets` CLI at `/opt/homebrew/bin/gws`. Already authenticated as loricstonge@gmail.com with drive + sheets scopes.

**Key commands:**
- Read: `gws sheets +read --spreadsheet "ID" --range "Sheet1!A1:Z10"`
- Write: `gws sheets spreadsheets values update --params '{"spreadsheetId": "...", "range": "...", "valueInputOption": "USER_ENTERED"}' --json '{"values": [...]}'`
- Batch structure changes: `gws sheets spreadsheets batchUpdate --params '{"spreadsheetId": "..."}' --json '{"requests": [...]}'`
- Drive: `gws drive files list`, `gws drive files create`

**Gotchas:**
- Output has `Using keyring backend: keyring` prefix — pipe through `grep -v "^Using keyring"` before JSON parsing
- zsh `!` in range strings — use double quotes not single quotes
- Apps Script API NOT in scopes — cannot read/modify Apps Script projects remotely. Use clasp (needs `clasp login`) or manual editor.
- For formulas, use `valueInputOption: USER_ENTERED`

**Not available:** No Sheets MCP server. No gspread/google-api-python-client installed. Clasp installed but not authenticated.
