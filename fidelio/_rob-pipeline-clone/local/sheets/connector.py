import json
import os
from functools import lru_cache

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv(override=True)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]


def _load_service_account_info() -> tuple[dict, str]:
    raw_value = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw_value:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON is not set")

    if os.path.exists(raw_value):
        with open(raw_value, encoding="utf-8") as handle:
            return json.load(handle), raw_value

    try:
        return json.loads(raw_value), "inline-json"
    except json.JSONDecodeError as exc:
        raise ValueError(
            "GOOGLE_SERVICE_ACCOUNT_JSON must be a JSON file path or inline JSON"
        ) from exc


@lru_cache(maxsize=1)
def _get_client() -> gspread.Client:
    service_account_info, _ = _load_service_account_info()
    creds = Credentials.from_service_account_info(
        service_account_info,
        scopes=SCOPES,
    )
    return gspread.authorize(creds)


@lru_cache(maxsize=8)
def get_sheet(sheet_id: str) -> gspread.Spreadsheet:
    return _get_client().open_by_key(sheet_id)


def _get_worksheet(sheet_id: str, tab_name: str) -> gspread.Worksheet:
    return get_sheet(sheet_id).worksheet(tab_name)


@lru_cache(maxsize=32)
def get_worksheet(sheet_id: str, tab_name: str) -> gspread.Worksheet:
    return _get_worksheet(sheet_id, tab_name)


def _get_headers(worksheet: gspread.Worksheet) -> tuple[list[str], int]:
    """Returns (headers, start_col_1based) — strips leading/trailing blank columns."""
    raw = worksheet.row_values(1)
    if not raw:
        raise ValueError(f"Worksheet '{worksheet.title}' is missing a header row")
    # Find first and last non-blank header
    start = next((i for i, h in enumerate(raw) if h.strip()), 0)
    end = max((i for i, h in enumerate(raw) if h.strip()), default=0) + 1
    return raw[start:end], start + 1  # start_col is 1-based


def _find_col_index(headers: list[str], col_name: str) -> int:
    normalized = col_name.strip().lower()
    for index, header in enumerate(headers, start=1):
        if header.strip().lower() == normalized:
            return index
    raise ValueError(f"Column '{col_name}' not found")


def ensure_column(sheet_id: str, tab_name: str, col_name: str) -> int:
    """Ensure a header column exists. Returns the 1-based column index."""
    worksheet = get_worksheet(sheet_id, tab_name)
    raw = worksheet.row_values(1)
    normalized = col_name.strip().lower()
    for index, header in enumerate(raw, start=1):
        if header.strip().lower() == normalized:
            return index

    next_col = len(raw) + 1 if raw else 1
    if next_col > worksheet.col_count:
        worksheet.add_cols(next_col - worksheet.col_count)
    worksheet.update_cell(1, next_col, col_name)
    return next_col


def append_row(sheet_id: str, tab_name: str, row_dict: dict) -> None:
    worksheet = get_worksheet(sheet_id, tab_name)
    headers, start_col = _get_headers(worksheet)

    row_lookup = {str(key).strip().lower(): value for key, value in row_dict.items()}
    unknown_columns = [
        key for key in row_dict if str(key).strip().lower() not in {h.strip().lower() for h in headers}
    ]
    if unknown_columns:
        raise ValueError(f"Unknown columns for '{tab_name}': {', '.join(map(str, unknown_columns))}")

    row_values = [row_lookup.get(header.strip().lower(), "") for header in headers]

    # Find next empty row and write directly to avoid gspread append shifting into wrong column
    all_vals = worksheet.get_all_values()
    next_row = len(all_vals) + 1
    # Write starting at the correct column
    import string
    col_letter = (
        string.ascii_uppercase[start_col - 1]
        if start_col <= 26
        else string.ascii_uppercase[(start_col - 1) // 26 - 1] + string.ascii_uppercase[(start_col - 1) % 26]
    )
    cell_range = f"{col_letter}{next_row}"
    worksheet.update(cell_range, [row_values], value_input_option="USER_ENTERED")


def update_cell(
    sheet_id: str,
    tab_name: str,
    row_index: int,
    col_name: str,
    value,
) -> None:
    worksheet = get_worksheet(sheet_id, tab_name)
    headers, start_col = _get_headers(worksheet)
    col_index = _find_col_index(headers, col_name) + start_col - 1  # absolute col in sheet
    worksheet.update_cell(row_index, col_index, value)


def find_row(sheet_id: str, tab_name: str, col_name: str, value) -> dict | None:
    """Find first matching row. Returns record dict with '_row_index' (1-based, including header)."""
    worksheet = get_worksheet(sheet_id, tab_name)
    all_values = worksheet.get_all_values()
    if not all_values:
        return None
    headers = all_values[0]
    last_col = max((i for i, h in enumerate(headers) if h.strip()), default=-1) + 1
    headers = headers[:last_col]

    col_index = _find_col_index(headers, col_name)
    target = "" if value is None else str(value)

    for i, row in enumerate(all_values[1:], start=2):  # i is 1-based row index (header=1)
        row = row[:last_col]
        if len(row) < col_index:
            continue
        if str(row[col_index - 1]) == target:
            record = {headers[j]: row[j] if j < len(row) else "" for j in range(len(headers))}
            record["_row_index"] = i
            return record
    return None


def get_all_rows(sheet_id: str, tab_name: str) -> list[dict]:
    """Return all rows in a tab as a list of dicts keyed by column header."""
    worksheet = get_worksheet(sheet_id, tab_name)
    all_values = worksheet.get_all_values()
    if not all_values:
        return []
    headers = all_values[0]
    # Find last non-empty header to ignore trailing blank columns
    last_col = max((i for i, h in enumerate(headers) if h.strip()), default=-1) + 1
    headers = headers[:last_col]
    rows = []
    for row in all_values[1:]:
        row = row[:last_col]
        if not any(v for v in row):  # skip fully empty rows
            continue
        rows.append({headers[i]: row[i] if i < len(row) else "" for i in range(len(headers))})
    return rows
