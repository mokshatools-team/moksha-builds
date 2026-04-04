"""
Google Sheets read/write operations for FDL1 Publishing Pipeline.
In mock mode: prints operations to console instead of writing to real Sheet.
"""

import os
import logging
from datetime import datetime

logger = logging.getLogger("fdl1.sheets")

MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"
MAX_RETRIES = 3

# In-memory mock store for testing
_mock_store = {}


def create_row(workbook_id: str, tab_name: str, columns: list, row_data: dict) -> bool:
    """
    Append a new row to the specified Sheet tab.
    row_data keys must match column names.
    """
    if MOCK_MODE:
        return _mock_create_row(workbook_id, tab_name, columns, row_data)

    return _real_create_row(workbook_id, tab_name, columns, row_data)


def update_cells(workbook_id: str, tab_name: str, asset_id: str, updates: dict) -> bool:
    """
    Update specific cells in an existing row identified by asset_id.
    updates: { column_name: new_value }
    """
    if MOCK_MODE:
        return _mock_update_cells(workbook_id, tab_name, asset_id, updates)

    return _real_update_cells(workbook_id, tab_name, asset_id, updates)


def find_row_by_field(workbook_id: str, tab_name: str, field: str, value: str):
    """
    Find a row where the given field matches the given value.
    Returns the row data as a dict, or None if not found.
    """
    if MOCK_MODE:
        return _mock_find_row(workbook_id, tab_name, field, value)

    return _real_find_row(workbook_id, tab_name, field, value)


# --- Mock implementations ---

def _mock_create_row(workbook_id: str, tab_name: str, columns: list, row_data: dict) -> bool:
    store_key = f"{workbook_id}/{tab_name}"
    if store_key not in _mock_store:
        _mock_store[store_key] = []

    # Build row with all columns, filling missing with empty string
    row = {col: row_data.get(col, "") for col in columns}
    _mock_store[store_key].append(row)

    logger.info(f"[MOCK SHEETS] New row in '{tab_name}':")
    for k, v in row.items():
        if v:
            logger.info(f"  {k}: {v}")
    return True


def _mock_update_cells(workbook_id: str, tab_name: str, asset_id: str, updates: dict) -> bool:
    store_key = f"{workbook_id}/{tab_name}"
    rows = _mock_store.get(store_key, [])

    for row in rows:
        if row.get("asset_id") == asset_id:
            row.update(updates)
            logger.info(f"[MOCK SHEETS] Updated '{asset_id}' in '{tab_name}':")
            for k, v in updates.items():
                logger.info(f"  {k}: {v}")
            return True

    # Also check by publer_id fields
    for row in rows:
        for field, val in row.items():
            if field.startswith("publer_id_") and val == asset_id:
                row.update(updates)
                logger.info(f"[MOCK SHEETS] Updated row (matched {field}={asset_id}) in '{tab_name}':")
                for k, v in updates.items():
                    logger.info(f"  {k}: {v}")
                return True

    logger.warning(f"[MOCK SHEETS] Row not found for asset_id={asset_id} in '{tab_name}'")
    return False


def _mock_find_row(workbook_id: str, tab_name: str, field: str, value: str):
    store_key = f"{workbook_id}/{tab_name}"
    rows = _mock_store.get(store_key, [])

    for row in rows:
        if row.get(field) == value:
            return row.copy()

    # Search across all tabs if tab_name not specified precisely
    if not rows:
        for key, tab_rows in _mock_store.items():
            for row in tab_rows:
                if row.get(field) == value:
                    return row.copy()

    return None


def get_mock_store() -> dict:
    """Access mock store for testing."""
    return _mock_store


def clear_mock_store():
    """Reset mock store between tests."""
    _mock_store.clear()


# --- Real implementations (stubs) ---

def _real_create_row(workbook_id: str, tab_name: str, columns: list, row_data: dict) -> bool:
    raise NotImplementedError("Real Sheets write not yet implemented. Set FDL1_MOCK_MODE=true.")


def _real_update_cells(workbook_id: str, tab_name: str, asset_id: str, updates: dict) -> bool:
    raise NotImplementedError("Real Sheets update not yet implemented. Set FDL1_MOCK_MODE=true.")


def _real_find_row(workbook_id: str, tab_name: str, field: str, value: str):
    raise NotImplementedError("Real Sheets find not yet implemented. Set FDL1_MOCK_MODE=true.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    # Quick test
    columns = ["asset_id", "filename", "content_type", "pipeline_status"]
    create_row("MOCK_WB", "Short Form", columns, {
        "asset_id": "PS14.1",
        "filename": "PS14.1 test video court.mp4",
        "content_type": "Podcast Short",
        "pipeline_status": "captions_ready"
    })

    update_cells("MOCK_WB", "Short Form", "PS14.1", {
        "pipeline_status": "drafted"
    })

    row = find_row_by_field("MOCK_WB", "Short Form", "asset_id", "PS14.1")
    print(f"\nFound row: {row}")
