#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials


def _rgb(hex_color: str) -> dict[str, float]:
    hex_color = hex_color.lstrip("#")
    return {
        "red": int(hex_color[0:2], 16) / 255,
        "green": int(hex_color[2:4], 16) / 255,
        "blue": int(hex_color[4:6], 16) / 255,
    }


CREDENTIALS_PATH = Path("/Users/robertsinclair/.inventory/credentials.json")
SPREADSHEET_TITLE = "Fidelio Pipeline — Dre Alexandra"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

TABS: list[tuple[str, list[str]]] = [
    (
        "Clip Index",
        ["Clip Name", "Duration", "Shoot Date", "FPS", "Resolution", "Status", "Processed Date"],
    ),
    (
        "Transcripts",
        ["Clip Name", "Full Transcript", "Processed Date"],
    ),
    (
        "Exports",
        ["File Name", "Review URL", "Export Date", "Duration", "Transcript Summary", "Content Type", "Status"],
    ),
    (
        "Metadata",
        [
            "File Name",
            "Review URL",
            "Title Option 1",
            "Title Option 2",
            "Title Option 3",
            "Description",
            "Tags",
            "Thumbnail URL",
        ],
    ),
    (
        "Publish Queue",
        [
            "File Name",
            "Review URL",
            "Approved Title",
            "Platform",
            "Scheduled Date",
            "Posted Date",
            "Post Link",
            "Approved By",
            "Cover Stitch",
            "Status",
        ],
    ),
]

TAB_COLORS = {
    "Clip Index": _rgb("#4A90D9"),
    "Transcripts": _rgb("#7B68EE"),
    "Exports": _rgb("#F5A623"),
    "Metadata": _rgb("#27AE60"),
    "Publish Queue": _rgb("#E74C3C"),
}

HEADER_BG = _rgb("#1A3A4A")
HEADER_TEXT = _rgb("#FFFFFF")
HEADER_BORDER = _rgb("#1A3A4A")
BAND_ONE = _rgb("#F2F8FB")
BAND_TWO = _rgb("#FFFFFF")
ACCENT_COLOR = _rgb("#1A3A4A")
DIVIDER_COLOR = _rgb("#D6E3EA")

TEXT_GREEN = _rgb("#1E8449")
TEXT_GOLD = _rgb("#B7950B")
TEXT_RED = _rgb("#922B21")
TEXT_BLUE = _rgb("#2471A3")
TEXT_NAVY = _rgb("#1A5276")

BG_GREEN = _rgb("#D5F5E3")
BG_GOLD = _rgb("#FEF9C3")
BG_RED = _rgb("#FADBD8")
BG_BLUE = _rgb("#EBF5FB")

ROW_STATUS_COLORS = {
    "Scheduled": _rgb("#DBEAFE"),
    "Posted": _rgb("#DCFCE7"),
    "Failed": _rgb("#FEE2E2"),
    "Ready for Review": _rgb("#FEF9C3"),
}

DEFAULT_WIDTHS = {
    "Duration": 70,
    "FPS": 70,
    "Status": 110,
    "Cover Stitch": 120,
    "Shoot Date": 110,
    "Processed Date": 110,
    "Export Date": 110,
    "Scheduled Date": 110,
    "Posted Date": 110,
}

TAB_WIDTHS = {
    "Transcripts": {
        "Clip Name": 220,
        "Full Transcript": 500,
        "Processed Date": 110,
    },
    "Metadata": {
        "Review URL": 260,
        "Description": 300,
        "Tags": 250,
    },
}

WRAP_COLUMNS = {
    "Transcripts": {"Full Transcript"},
    "Metadata": {"Description", "Tags"},
}

DATA_VALIDATION_RULES = {
    "Clip Index": {
        "Status": ["Processing", "Transcribed", "Failed"],
    },
    "Exports": {
        "Status": ["Generating Metadata", "Ready for Review", "Approved", "Failed"],
        "Content Type": ["Long-form", "Short-form Reel"],
    },
    "Publish Queue": {
        "Status": ["Scheduled", "Posted", "Failed", "Cancelled"],
        "Platform": ["YouTube", "Instagram", "TikTok", "Facebook"],
        "Cover Stitch": ["Stitched", "Original video"],
    },
}

CELL_STATUS_RULES = {
    "Clip Index": {
        "Status": [
            ("Transcribed", BG_GREEN, TEXT_GREEN, False),
            ("Processing", BG_GOLD, TEXT_GOLD, False),
            ("Failed", BG_RED, TEXT_RED, False),
        ],
    },
    "Exports": {
        "Status": [
            ("Ready for Review", BG_GOLD, TEXT_GOLD, False),
            ("Approved", BG_GREEN, TEXT_GREEN, False),
            ("Generating Metadata", BG_BLUE, TEXT_BLUE, False),
            ("Failed", BG_RED, TEXT_RED, False),
        ],
    },
    "Publish Queue": {
        "Status": [
            ("Scheduled", None, TEXT_NAVY, True),
            ("Posted", None, TEXT_GREEN, True),
            ("Failed", None, TEXT_RED, True),
        ],
    },
}


def _get_client() -> gspread.Client:
    if not CREDENTIALS_PATH.exists():
        raise FileNotFoundError(f"Credentials file not found: {CREDENTIALS_PATH}")

    creds = Credentials.from_service_account_file(str(CREDENTIALS_PATH), scopes=SCOPES)
    return gspread.authorize(creds)


def _column_width(tab_name: str, header: str) -> int:
    if header in TAB_WIDTHS.get(tab_name, {}):
        return TAB_WIDTHS[tab_name][header]
    if header in DEFAULT_WIDTHS:
        return DEFAULT_WIDTHS[header]
    if "Name" in header or "Title" in header:
        return 200
    return 200


def _header_alignment(header: str) -> str:
    return "CENTER" if header in {"FPS", "Duration", "Status"} else "LEFT"


def _col_index(headers: list[str], name: str) -> int:
    return headers.index(name)


def _repeat_cell_request(
    *,
    sheet_id: int,
    start_row: int,
    end_row: int,
    start_col: int,
    end_col: int,
    fmt: dict,
    fields: str,
) -> dict:
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": start_row,
                "endRowIndex": end_row,
                "startColumnIndex": start_col,
                "endColumnIndex": end_col,
            },
            "cell": {"userEnteredFormat": fmt},
            "fields": fields,
        }
    }


def _data_validation_request(
    sheet_id: int,
    start_col: int,
    end_col: int,
    values: list[str],
) -> dict:
    return {
        "setDataValidation": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 1,
                "endRowIndex": 100,
                "startColumnIndex": start_col,
                "endColumnIndex": end_col,
            },
            "rule": {
                "condition": {
                    "type": "ONE_OF_LIST",
                    "values": [{"userEnteredValue": value} for value in values],
                },
                "showCustomUi": True,
                "strict": False,
            },
        }
    }


def _conditional_rule(
    *,
    sheet_id: int,
    formula: str,
    start_row: int,
    start_col: int,
    end_col: int,
    bg: dict[str, float] | None,
    text: dict[str, float] | None,
    bold: bool = False,
) -> dict:
    fmt: dict = {}
    if bg:
        fmt["backgroundColor"] = bg
    if text or bold:
        fmt["textFormat"] = {}
        if text:
            fmt["textFormat"]["foregroundColor"] = text
        if bold:
            fmt["textFormat"]["bold"] = True

    return {
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [
                    {
                        "sheetId": sheet_id,
                        "startRowIndex": start_row,
                        "startColumnIndex": start_col,
                        "endColumnIndex": end_col,
                    }
                ],
                "booleanRule": {
                    "condition": {
                        "type": "CUSTOM_FORMULA",
                        "values": [{"userEnteredValue": formula}],
                    },
                    "format": fmt,
                },
            },
            "index": 0,
        }
    }


def _sheet_requests(tab_name: str, sheet_id: int, headers: list[str]) -> list[dict]:
    requests: list[dict] = [
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "tabColorStyle": {"rgbColor": TAB_COLORS[tab_name]},
                    "gridProperties": {
                        "frozenRowCount": 1,
                        "hideGridlines": True,
                    },
                },
                "fields": "tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines",
            }
        },
        _repeat_cell_request(
            sheet_id=sheet_id,
            start_row=0,
            end_row=1,
            start_col=0,
            end_col=len(headers),
            fmt={
                "backgroundColor": HEADER_BG,
                "horizontalAlignment": "LEFT",
                "textFormat": {
                    "foregroundColor": HEADER_TEXT,
                    "bold": True,
                    "fontSize": 11,
                },
                "borders": {
                    "bottom": {
                        "style": "SOLID_MEDIUM",
                        "color": HEADER_BORDER,
                    }
                },
            },
            fields="userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,borders.bottom)",
        ),
        {
            "addBanding": {
                "bandedRange": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": 100,
                        "startColumnIndex": 0,
                        "endColumnIndex": len(headers),
                    },
                    "rowProperties": {
                        "firstBandColor": BAND_ONE,
                        "secondBandColor": BAND_TWO,
                    },
                }
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 0,
                    "endIndex": 1,
                },
                "properties": {"pixelSize": 32},
                "fields": "pixelSize",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 1,
                    "endIndex": 100,
                },
                "properties": {"pixelSize": 21},
                "fields": "pixelSize",
            }
        },
        _repeat_cell_request(
            sheet_id=sheet_id,
            start_row=1,
            end_row=100,
            start_col=0,
            end_col=1,
            fmt={"textFormat": {"bold": True}},
            fields="userEnteredFormat.textFormat.bold",
        ),
    ]

    for index, header in enumerate(headers):
        requests.append(
            {
                "updateDimensionProperties": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": index,
                        "endIndex": index + 1,
                    },
                    "properties": {"pixelSize": _column_width(tab_name, header)},
                    "fields": "pixelSize",
                }
            }
        )
        requests.append(
            _repeat_cell_request(
                sheet_id=sheet_id,
                start_row=0,
                end_row=100,
                start_col=index,
                end_col=index + 1,
                fmt={"horizontalAlignment": _header_alignment(header)},
                fields="userEnteredFormat.horizontalAlignment",
            )
        )

        if index < len(headers) - 1:
            requests.append(
                _repeat_cell_request(
                    sheet_id=sheet_id,
                    start_row=0,
                    end_row=100,
                    start_col=index,
                    end_col=index + 1,
                    fmt={
                        "borders": {
                            "right": {
                                "style": "SOLID",
                                "color": DIVIDER_COLOR,
                            }
                        }
                    },
                    fields="userEnteredFormat.borders.right",
                )
            )

        if header in WRAP_COLUMNS.get(tab_name, set()):
            requests.append(
                _repeat_cell_request(
                    sheet_id=sheet_id,
                    start_row=1,
                    end_row=100,
                    start_col=index,
                    end_col=index + 1,
                    fmt={"wrapStrategy": "WRAP"},
                    fields="userEnteredFormat.wrapStrategy",
                )
            )

    if tab_name == "Publish Queue":
        requests.append(
            _repeat_cell_request(
                sheet_id=sheet_id,
                start_row=0,
                end_row=100,
                start_col=1,
                end_col=2,
                fmt={
                    "borders": {
                        "left": {
                            "style": "SOLID_MEDIUM",
                            "color": ACCENT_COLOR,
                        }
                    }
                },
                fields="userEnteredFormat.borders.left",
            )
        )

    for column_name, values in DATA_VALIDATION_RULES.get(tab_name, {}).items():
        col = _col_index(headers, column_name)
        requests.append(_data_validation_request(sheet_id, col, col + 1, values))

    for column_name, rules in CELL_STATUS_RULES.get(tab_name, {}).items():
        col = _col_index(headers, column_name)
        column_letter = chr(ord("A") + col)
        for status, bg, text, bold in rules:
            requests.append(
                _conditional_rule(
                    sheet_id=sheet_id,
                    formula=f'=${column_letter}2="{status}"',
                    start_row=1,
                    start_col=col,
                    end_col=col + 1,
                    bg=bg,
                    text=text,
                    bold=bold,
                )
            )

    if tab_name == "Publish Queue":
        status_col = _col_index(headers, "Status")
        status_letter = chr(ord("A") + status_col)
        for status, bg in ROW_STATUS_COLORS.items():
            requests.append(
                _conditional_rule(
                    sheet_id=sheet_id,
                    formula=f'=${status_letter}2="{status}"',
                    start_row=1,
                    start_col=0,
                    end_col=8,
                    bg=bg,
                    text=None,
                )
            )

    return requests


def main() -> None:
    client = _get_client()
    temp_sheet = None

    if len(sys.argv) > 1:
        spreadsheet = client.open_by_key(sys.argv[1])
        print(f"Opened existing sheet: {spreadsheet.title}")
        existing = spreadsheet.worksheets()
        temp_sheet = spreadsheet.add_worksheet(title="_temp", rows=1, cols=1)
        for worksheet in existing:
            spreadsheet.del_worksheet(worksheet)
    else:
        spreadsheet = client.create(SPREADSHEET_TITLE)
        spreadsheet.del_worksheet(spreadsheet.sheet1)

    created_sheets: dict[str, gspread.Worksheet] = {}
    for title, headers in TABS:
        worksheet = spreadsheet.add_worksheet(title=title, rows=100, cols=len(headers))
        worksheet.update([headers], "A1")
        created_sheets[title] = worksheet

    if temp_sheet is not None:
        spreadsheet.del_worksheet(temp_sheet)

    requests: list[dict] = []
    for title, headers in TABS:
        requests.extend(_sheet_requests(title, created_sheets[title].id, headers))

    spreadsheet.batch_update({"requests": requests})

    print(f"Sheet ID: {spreadsheet.id}")
    print(f"URL: https://docs.google.com/spreadsheets/d/{spreadsheet.id}")


if __name__ == "__main__":
    main()
