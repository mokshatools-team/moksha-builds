"""
sheet_connector.py — Read from and write to a Google Sheet via gspread.

Setup:
  1. Create a Google Cloud service account
  2. Enable Google Sheets API + Google Drive API
  3. Download the JSON key, set GOOGLE_CREDS_JSON path in .env
  4. Share your sheet with the service account email (editor access)
"""

import logging
import gspread
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]


def _get_client(creds_path: str) -> gspread.Client:
    creds = Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    return gspread.authorize(creds)


def connect(sheet_id: str, creds_path: str):
    """Open the spreadsheet once and return (client, spreadsheet)."""
    client = _get_client(creds_path)
    spreadsheet = client.open_by_key(sheet_id)
    return client, spreadsheet


def read_config_tab(spreadsheet, config_tab_name: str = "CONFIG") -> dict:
    """
    Read the CONFIG tab and return {function_name: column_name}.
    Raises ValueError with a clear message if the tab is missing or unreadable.
    """
    try:
        ws = spreadsheet.worksheet(config_tab_name)
    except gspread.exceptions.WorksheetNotFound:
        raise ValueError(
            f"CONFIG tab not found in this Google Sheet. "
            f"Please create a tab named exactly '{config_tab_name}' with two columns: "
            f"'Column Function' (A) and 'Column Name' (B)."
        )

    try:
        rows = ws.get_all_values()
        mapping = {}
        for row in rows[1:]:  # skip header row (Column Function | Column Name)
            if len(row) >= 2 and row[0].strip():
                mapping[row[0].strip()] = row[1].strip()
        logger.info(f"Loaded {len(mapping)} column mappings from CONFIG tab")
        return mapping
    except Exception as e:
        raise ValueError(f"Error reading CONFIG tab: {e}")


def read_worksheet(spreadsheet, worksheet_name: str) -> dict:
    """
    Returns:
        {
            "rows": list of dicts (header row as keys),
            "headers": list of column names,
            "worksheet": gspread.Worksheet,
        }
    """
    try:
        ws = spreadsheet.worksheet(worksheet_name)
    except Exception:
        all_tabs = spreadsheet.worksheets()
        ws = next((t for t in all_tabs if t.title.strip() == worksheet_name.strip()), None)
        if not ws:
            raise

    rows = ws.get_all_records(default_blank="")
    headers = ws.row_values(1)

    logger.info(f"Read {len(rows)} rows from sheet '{worksheet_name}'")
    return {"rows": rows, "headers": headers, "worksheet": ws}


# Kept for backward compatibility
def read_sheet(sheet_id: str, worksheet_name: str, creds_path: str) -> dict:
    _, spreadsheet = connect(sheet_id, creds_path)
    return read_worksheet(spreadsheet, worksheet_name)


def batch_update(worksheet: gspread.Worksheet, updates: list[dict]) -> int:
    """
    Write multiple cells at once.
    Each update: {"row": int, "col": int, "value": str}  (1-indexed, row 1 = header)
    Returns count of cells updated.
    """
    if not updates:
        return 0

    cell_list = []
    for u in updates:
        cell = worksheet.cell(u["row"], u["col"])
        cell.value = u["value"]
        cell_list.append(cell)

    worksheet.update_cells(cell_list, value_input_option="USER_ENTERED")
    logger.info(f"Updated {len(cell_list)} cells")
    return len(cell_list)


def col_index_for_header(headers: list[str], header_name: str) -> int:
    """Return 1-indexed column number for a header name, or 0 if not found."""
    if not header_name:
        return 0
    try:
        return headers.index(header_name) + 1
    except ValueError:
        pass
    # Case-insensitive strip match as fallback
    h_lower = header_name.strip().lower()
    for i, h in enumerate(headers):
        if h.strip().lower() == h_lower:
            return i + 1
    return 0
