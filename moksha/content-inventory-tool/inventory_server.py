#!/usr/bin/env python3
"""
Content Inventory Tool — inventory.mokshatools.com
Scrapes YouTube + TikTok channels, diffs against a Google Sheet, writes gaps back.
v2: CONFIG tab driven, HH-aware, full approval flow with chat corrections.
"""

import json
import logging
import os
import re
import threading
from datetime import date, datetime

from flask import Flask, jsonify, redirect, render_template_string, request, session, url_for

import config
from inventory_scraper import scrape_tiktok, scrape_youtube
from sheet_connector import connect, read_config_tab, read_worksheet, batch_update, col_index_for_header
from rapidfuzz import fuzz, process as rfprocess

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            os.path.join(os.path.dirname(__file__), "logs", "inventory.log")
        ),
    ],
)
logger = logging.getLogger(__name__)

# ── Flask App ──────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.urandom(24)

@app.after_request
def no_cache(r):
    r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    return r

# ── Global Scan State ──────────────────────────────────────────────────────────

_state = {
    "status": "idle",    # idle | scanning | done | error
    "progress": "",
    "results": None,     # dict with diff_rows, col_idx, worksheet, stats, etc.
    "error": None,
    "last_scan": None,
}
_state_lock = threading.Lock()

# ── Column Map Helpers ─────────────────────────────────────────────────────────

# These function labels must be present in the CONFIG tab for the scan to run.
_REQUIRED_COL_FUNCTIONS = [
    "Title Column",
    "Session Column",
]

# These are used for write-back if present; scan still runs without them.
_OPTIONAL_COL_FUNCTIONS = [
    "YT Studio Column",
    "TikTok Date Column",
    "IG/FB Date Column",
    "YT Shorts Status Column",
    "YT Shorts Title Column",
    "YT Shorts Date Column",
]


def _col_name(col_map: dict, function_name: str) -> str:
    """Get the column name for a function label. Returns '' if not in CONFIG tab."""
    return col_map.get(function_name, "")


def _validate_col_map(col_map: dict):
    """
    Raise ValueError listing any required function labels missing from the CONFIG tab.
    Optional labels are silently skipped if absent.
    """
    missing = [fn for fn in _REQUIRED_COL_FUNCTIONS if not col_map.get(fn)]
    if missing:
        raise ValueError(
            f"CONFIG tab is missing required function label(s): {', '.join(missing)}. "
            f"Add a row for each in the CONFIG tab with the exact column name from your sheet."
        )


def _build_col_idx(col_map: dict, headers: list[str]) -> dict:
    """
    Build {function_name: col_index_1based} for all known column functions.
    Returns 0 for optional columns not found in the CONFIG tab or sheet.
    """
    idx = {}
    for fn in _REQUIRED_COL_FUNCTIONS + _OPTIONAL_COL_FUNCTIONS:
        name = _col_name(col_map, fn)
        idx[fn] = col_index_for_header(headers, name) if name else 0
    return idx


# ── Matching ───────────────────────────────────────────────────────────────────

_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U00010000-\U0010FFFF"
    "]+",
    flags=re.UNICODE,
)

_HASHTAG_RE    = re.compile(r'#\w+')
_NUM_PREFIX_RE = re.compile(r'^\d+[\.\d]*\s+')
_DASH_PREFIX_RE = re.compile(r'^v?\d+[\.\d]*\s*[—\-–]\s*', re.IGNORECASE)


def _normalize(title: str) -> str:
    t = _EMOJI_RE.sub("", title)
    t = _HASHTAG_RE.sub(" ", t)
    t = _DASH_PREFIX_RE.sub("", t)
    t = _NUM_PREFIX_RE.sub("", t)
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip().lower()


FUZZY_THRESHOLD  = 82
REVIEW_THRESHOLD = 65

_YT_ID_RE = re.compile(r'(?:v=|youtu\.be/|shorts/)([a-zA-Z0-9_-]{11})')


def _extract_yt_id(url: str) -> str:
    if not url:
        return ""
    m = _YT_ID_RE.search(str(url))
    return m.group(1) if m else ""


def _build_lookup(platform_videos: list[dict]) -> dict:
    return {_normalize(v["title"]): v for v in platform_videos if v.get("title")}


def _build_id_lookup(platform_videos: list[dict]) -> dict:
    return {v["id"]: v for v in platform_videos if v.get("id")}


def _match_title(sheet_title: str, lookup: dict, platform_videos: list[dict]) -> dict:
    """
    Match a sheet title against platform video list.
    Returns {"video": dict|None, "score": int, "status": "exact"|"fuzzy"|"review"|"none"}
    """
    norm = _normalize(sheet_title)

    if norm in lookup:
        return {"video": lookup[norm], "score": 100, "status": "exact"}

    if not platform_videos:
        return {"video": None, "score": 0, "status": "none"}

    choices = [_normalize(v["title"]) for v in platform_videos if v.get("title")]
    if not choices:
        return {"video": None, "score": 0, "status": "none"}

    best_match, score, _ = rfprocess.extractOne(norm, choices, scorer=fuzz.token_set_ratio)

    if score >= FUZZY_THRESHOLD:
        return {"video": lookup.get(best_match), "score": int(score), "status": "fuzzy"}
    elif score >= REVIEW_THRESHOLD:
        return {"video": lookup.get(best_match), "score": int(score), "status": "review"}
    else:
        return {"video": None, "score": int(score), "status": "none"}


def _is_published(val) -> bool:
    if not val:
        return False
    s = str(val).strip().lower()
    return s not in ("", "false", "no", "0", "-")


def _detect_session_type(session_val: str) -> tuple[bool, str]:
    """
    Returns (is_hh, display_label).
    is_hh=True if the session value is "HH" (case-insensitive).
    display_label is the raw session value or "—" if empty.
    """
    v = str(session_val).strip()
    if v.upper() == "HH":
        return True, "HH"
    return False, v or "—"


def _decide_action(sheet_marked: bool, found: bool, needs_review: bool, was_scraped: bool) -> str:
    if not was_scraped:   return "not_scraped"
    if sheet_marked and found:            return "confirmed"
    if sheet_marked and not found:        return "missing"
    if not sheet_marked and found:        return "update"
    if not sheet_marked and needs_review: return "review"
    return "pending"


# ── Scan Logic ─────────────────────────────────────────────────────────────────

def _set_progress(msg: str):
    with _state_lock:
        _state["progress"] = msg
    logger.info(msg)


def _run_scan():
    with _state_lock:
        _state["status"] = "scanning"
        _state["error"] = None
        _state["results"] = None

    try:
        # 1. Connect to sheet
        _set_progress("Connecting to Google Sheet…")
        _, spreadsheet = connect(config.GOOGLE_SHEET_ID, config.GOOGLE_CREDS_JSON)

        # 2. Read CONFIG tab → column mapping (raises if tab missing or required labels absent)
        _set_progress("Reading CONFIG tab…")
        col_map = read_config_tab(spreadsheet, config.SHEET_CONFIG_TAB)
        _validate_col_map(col_map)

        # 3. Read data worksheet
        _set_progress("Reading TT CONTENT tab…")
        sheet_data = read_worksheet(spreadsheet, config.SHEET_WORKSHEET_NAME)
        rows    = sheet_data["rows"]
        headers = sheet_data["headers"]
        ws      = sheet_data["worksheet"]

        # 4. Build column index map
        col_idx = _build_col_idx(col_map, headers)

        title_col     = _col_name(col_map, "Title Column")
        session_col   = _col_name(col_map, "Session Column")
        studio_col    = _col_name(col_map, "YT Studio Column")
        tt_date_col   = _col_name(col_map, "TikTok Date Column")
        fb_date_col   = _col_name(col_map, "IG/FB Date Column")
        yt_status_col = _col_name(col_map, "YT Shorts Status Column")
        yt_title_col  = _col_name(col_map, "YT Shorts Title Column")
        yt_date_col   = _col_name(col_map, "YT Shorts Date Column")

        # 5. Scrape platforms
        _set_progress("Scraping YouTube Shorts…")
        yt_videos = scrape_youtube(config.YOUTUBE_CHANNEL_URL) if config.YOUTUBE_CHANNEL_URL else []

        _set_progress("Scraping TikTok channel…")
        tt_videos = scrape_tiktok(config.TIKTOK_CHANNEL_URL) if config.TIKTOK_CHANNEL_URL else []

        # 6. Build lookup maps
        yt_lookup    = _build_lookup(yt_videos)
        yt_id_lookup = _build_id_lookup(yt_videos)
        tt_lookup    = _build_lookup(tt_videos)

        # 7. Diff each row
        diff_rows = []
        for i, row in enumerate(rows):
            sheet_row_num = i + 2  # +2 because row 1 is header
            title = str(row.get(title_col, "")).strip()
            if not title:
                continue

            # Session type detection
            session_raw = str(row.get(session_col, "")).strip() if session_col else ""
            is_hh, session_display = _detect_session_type(session_raw)

            # Sheet field values
            studio_url       = str(row.get(studio_col, "")).strip() if studio_col else ""
            tt_date_sheet    = str(row.get(tt_date_col, "")).strip() if tt_date_col else ""
            fb_published     = _is_published(row.get(fb_date_col)) if fb_date_col else False
            fb_date_sheet    = str(row.get(fb_date_col, "")).strip() if fb_date_col else ""
            yt_status_sheet  = str(row.get(yt_status_col, "")).strip() if yt_status_col else ""
            yt_title_sheet   = str(row.get(yt_title_col, "")).strip() if yt_title_col else ""
            yt_date_sheet    = str(row.get(yt_date_col, "")).strip() if yt_date_col else ""

            # TikTok: every row in the sheet is a TikTok video (primary platform)
            sheet_tt = True

            # YT Shorts: marked if any YT shorts status or prior match exists
            sheet_yt = bool(yt_status_sheet and yt_status_sheet != "Not Posted")

            # Match TikTok
            tt_match = _match_title(title, tt_lookup, tt_videos) if tt_videos else {
                "video": None, "score": 0, "status": "not_scraped"
            }
            tt_found  = tt_match["status"] in ("exact", "fuzzy")
            tt_review = tt_match["status"] == "review"
            tt_video  = tt_match["video"] or {}

            # Match YouTube Shorts — try ID from studio URL first, then title match
            yt_video_id = _extract_yt_id(studio_url)
            if yt_video_id and yt_video_id in yt_id_lookup:
                yt_match = {"video": yt_id_lookup[yt_video_id], "score": 100, "status": "exact"}
            elif yt_videos:
                yt_match = _match_title(title, yt_lookup, yt_videos)
            else:
                yt_match = {"video": None, "score": 0, "status": "not_scraped"}

            yt_found  = yt_match["status"] in ("exact", "fuzzy")
            yt_review = yt_match["status"] == "review"
            yt_video  = yt_match["video"] or {}

            # YT Studio flag: only flag session videos (not HH) missing a studio URL
            yt_studio_flagged = (not is_hh) and (not studio_url)

            # Actions
            tt_action = _decide_action(sheet_tt, tt_found, tt_review, bool(tt_videos))
            yt_action = _decide_action(sheet_yt, yt_found, yt_review, bool(yt_videos))

            diff_rows.append({
                # Identity
                "row_num":           sheet_row_num,
                "title":             title,
                "session_type":      session_display,
                "is_hh":             is_hh,
                # TikTok
                "tt_date_sheet":     tt_date_sheet,
                "tt_scraped_title":  tt_video.get("title", ""),
                "tt_scraped_date":   tt_video.get("upload_date", ""),
                "tt_match_status":   tt_match["status"],
                "tt_match_score":    tt_match["score"],
                "tt_match_url":      tt_video.get("url", ""),
                "tt_action":         tt_action,
                # IG/FB
                "fb_published":      fb_published,
                "fb_date_sheet":     fb_date_sheet,
                # YT Shorts
                "yt_scraped_title":  yt_video.get("title", ""),
                "yt_scraped_date":   yt_video.get("upload_date", ""),
                "yt_match_status":   yt_match["status"],
                "yt_match_score":    yt_match["score"],
                "yt_match_url":      yt_video.get("url", ""),
                "yt_action":         yt_action,
                "yt_status_sheet":   yt_status_sheet,
                "yt_title_sheet":    yt_title_sheet,
                "yt_date_sheet":     yt_date_sheet,
                # YT Studio
                "yt_studio_url":     studio_url,
                "yt_studio_flagged": yt_studio_flagged,
                # Column indices for write-back
                "col_tt_date":       col_idx.get("TikTok Date Column", 0),
                "col_yt_status":     col_idx.get("YT Shorts Status Column", 0),
                "col_yt_title":      col_idx.get("YT Shorts Title Column", 0),
                "col_yt_date":       col_idx.get("YT Shorts Date Column", 0),
                # UI state (mutable after scan)
                "checked":           True,
                "flagged":           False,
                "flag_note":         "",
                "force_matched_tt":  False,
                "force_matched_yt":  False,
            })

        # 8. Untracked (on platform but not in sheet)
        matched_tt_urls = {r["tt_match_url"] for r in diff_rows if r["tt_match_url"]}
        matched_yt_urls = {r["yt_match_url"] for r in diff_rows if r["yt_match_url"]}
        untracked_tt = [v for v in tt_videos if v["url"] not in matched_tt_urls]
        untracked_yt = [v for v in yt_videos if v["url"] not in matched_yt_urls]

        # 9. Stats
        stats = {
            "total_in_sheet":    len(diff_rows),
            "yt_videos_live":    len(yt_videos),
            "tt_videos_live":    len(tt_videos),
            "tt_gaps":           sum(1 for r in diff_rows if r["tt_action"] in ("update", "review")),
            "yt_gaps":           sum(1 for r in diff_rows if r["yt_action"] in ("update", "review")),
            "studio_flags":      sum(1 for r in diff_rows if r["yt_studio_flagged"]),
            "untracked_tt":      len(untracked_tt),
            "untracked_yt":      len(untracked_yt),
        }

        with _state_lock:
            _state["results"] = {
                "diff_rows":     diff_rows,
                "untracked_tt":  untracked_tt,
                "untracked_yt":  untracked_yt,
                "stats":         stats,
                "worksheet":     ws,
            }
            _state["status"]    = "done"
            _state["last_scan"] = datetime.now().strftime("%Y-%m-%d %H:%M")
            _state["progress"]  = ""

        logger.info(f"Scan complete. {len(diff_rows)} rows processed.")

    except Exception as e:
        logger.exception("Scan failed")
        with _state_lock:
            _state["status"] = "error"
            _state["error"]  = str(e)
            _state["progress"] = ""


# ── Write-Back Logic ───────────────────────────────────────────────────────────

def _build_writes(row: dict) -> list[dict]:
    """
    Build the list of cell updates for a single approved row.
    Only writes cells where we have scraped data and the sheet col exists.
    """
    updates = []

    # TikTok publish date (scraped)
    if row.get("tt_scraped_date") and row.get("col_tt_date"):
        updates.append({"row": row["row_num"], "col": row["col_tt_date"], "value": row["tt_scraped_date"]})

    # YT Shorts — only write if we found it on YT
    yt_found = row["yt_action"] in ("confirmed", "update") or row.get("force_matched_yt")
    if yt_found:
        if row.get("yt_scraped_title") and row.get("col_yt_title"):
            updates.append({"row": row["row_num"], "col": row["col_yt_title"], "value": row["yt_scraped_title"]})
        if row.get("yt_scraped_date") and row.get("col_yt_date"):
            updates.append({"row": row["row_num"], "col": row["col_yt_date"], "value": row["yt_scraped_date"]})
        if row.get("col_yt_status"):
            # "From Studio" = short found AND session video has a studio URL
            # "From TikTok" = short found but no studio URL (or HH video)
            status_val = "From Studio" if (row.get("yt_studio_url") and not row["is_hh"]) else "From TikTok"
            updates.append({"row": row["row_num"], "col": row["col_yt_status"], "value": status_val})

    return updates


# ── Auth Helpers ───────────────────────────────────────────────────────────────

def _requires_auth():
    if not config.INVENTORY_PASSWORD:
        return False
    return not session.get("authenticated")


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        if request.form.get("password") == config.INVENTORY_PASSWORD:
            session["authenticated"] = True
            return redirect(url_for("index"))
        error = "Incorrect password."
    return render_template_string(LOGIN_HTML, error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
def index():
    if _requires_auth():
        return redirect(url_for("login"))
    return render_template_string(DASHBOARD_HTML,
        yt_url=config.YOUTUBE_CHANNEL_URL,
        tt_url=config.TIKTOK_CHANNEL_URL,
        sheet_id=config.GOOGLE_SHEET_ID,
        password_enabled=bool(config.INVENTORY_PASSWORD),
        chat_enabled=bool(config.OPENAI_API_KEY),
    )


@app.route("/api/scan", methods=["POST"])
def api_scan():
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401
    with _state_lock:
        if _state["status"] == "scanning":
            return jsonify({"error": "Scan already in progress"}), 409
    t = threading.Thread(target=_run_scan, daemon=True)
    t.start()
    return jsonify({"ok": True})


@app.route("/api/status")
def api_status():
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401
    with _state_lock:
        return jsonify({
            "status":    _state["status"],
            "progress":  _state["progress"],
            "error":     _state["error"],
            "last_scan": _state["last_scan"],
        })


@app.route("/api/results")
def api_results():
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401
    with _state_lock:
        r = _state["results"]
    if r is None:
        return jsonify({"error": "No results yet"}), 404
    return jsonify({
        "diff_rows":    r["diff_rows"],
        "untracked_tt": r["untracked_tt"],
        "untracked_yt": r["untracked_yt"],
        "stats":        r["stats"],
    })


@app.route("/api/flag", methods=["POST"])
def api_flag():
    """Toggle flagged state on a row. Body: {row_num, flagged, note}"""
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401

    body     = request.get_json(force=True)
    row_num  = body.get("row_num")
    flagged  = bool(body.get("flagged", True))
    note     = str(body.get("note", "")).strip()

    with _state_lock:
        r = _state["results"]
        if r is None:
            return jsonify({"error": "No scan results available"}), 400
        for row in r["diff_rows"]:
            if row["row_num"] == row_num:
                row["flagged"]    = flagged
                row["flag_note"]  = note if flagged else ""
                return jsonify({"ok": True, "row_num": row_num, "flagged": flagged})

    return jsonify({"error": f"Row {row_num} not found"}), 404


@app.route("/api/check", methods=["POST"])
def api_check():
    """Set checked state on one or more rows. Body: {row_nums: [...], checked: bool}"""
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401

    body     = request.get_json(force=True)
    row_nums = set(body.get("row_nums", []))
    checked  = bool(body.get("checked", True))

    with _state_lock:
        r = _state["results"]
        if r is None:
            return jsonify({"error": "No scan results available"}), 400
        updated = 0
        for row in r["diff_rows"]:
            if row["row_num"] in row_nums:
                row["checked"] = checked
                updated += 1

    return jsonify({"ok": True, "updated": updated})


@app.route("/api/correct", methods=["POST"])
def api_correct():
    """
    Apply a plain language correction to the in-memory result set via GPT-4o-mini.
    Body: {instruction: str}
    Returns: {ok, ops_applied, message}
    """
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401
    if not config.OPENAI_API_KEY:
        return jsonify({"error": "Chat corrections require OPENAI_API_KEY in .env"}), 400

    body        = request.get_json(force=True)
    instruction = str(body.get("instruction", "")).strip()
    if not instruction:
        return jsonify({"error": "No instruction provided"}), 400

    with _state_lock:
        r = _state["results"]
    if r is None:
        return jsonify({"error": "No scan results available"}), 400

    # Build compact row summary for GPT context
    row_summary = []
    for row in r["diff_rows"]:
        row_summary.append({
            "row": row["row_num"],
            "title": row["title"],
            "session": row["session_type"],
            "tt": row["tt_action"],
            "tt_scraped": row["tt_scraped_title"],
            "yt": row["yt_action"],
            "yt_scraped": row["yt_scraped_title"],
            "checked": row["checked"],
            "flagged": row["flagged"],
        })

    system_prompt = """You are adjusting a video content inventory result set.
The user will describe a plain language correction. Return ONLY a JSON array of patch operations. No explanation, no markdown.

Valid operations:
- {"op": "uncheck", "row": N}  — remove row N from the write batch
- {"op": "check", "row": N}    — add row N to the write batch
- {"op": "flag", "row": N, "note": "reason"}  — flag row N as needing review
- {"op": "unflag", "row": N}   — clear flag on row N
- {"op": "force_match_tt", "row": N}  — override TikTok match to confirmed (user says it's correct)
- {"op": "force_match_yt", "row": N}  — override YT Shorts match to confirmed

Only include ops clearly implied by the instruction. Return [] if nothing applies."""

    user_msg = f"Current rows:\n{json.dumps(row_summary, ensure_ascii=False)}\n\nInstruction: {instruction}"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0,
            max_tokens=512,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        ops = json.loads(raw)
    except Exception as e:
        logger.error(f"GPT correction failed: {e}")
        return jsonify({"error": f"AI correction failed: {e}"}), 500

    # Apply operations
    applied = 0
    row_map = {row["row_num"]: row for row in r["diff_rows"]}
    with _state_lock:
        for op in ops:
            row_num = op.get("row")
            if row_num not in row_map:
                continue
            row = row_map[row_num]
            if op["op"] == "uncheck":
                row["checked"] = False; applied += 1
            elif op["op"] == "check":
                row["checked"] = True; applied += 1
            elif op["op"] == "flag":
                row["flagged"] = True; row["flag_note"] = op.get("note", ""); applied += 1
            elif op["op"] == "unflag":
                row["flagged"] = False; row["flag_note"] = ""; applied += 1
            elif op["op"] == "force_match_tt":
                row["force_matched_tt"] = True; row["tt_action"] = "confirmed"; applied += 1
            elif op["op"] == "force_match_yt":
                row["force_matched_yt"] = True; row["yt_action"] = "confirmed"; applied += 1

    return jsonify({"ok": True, "ops_applied": applied, "ops": ops})


@app.route("/api/confirm", methods=["POST"])
def api_confirm():
    """
    Final write to sheet. Validates no checked+unresolved flagged rows.
    Body: {} (uses in-memory checked/flagged state)
    """
    if _requires_auth():
        return jsonify({"error": "unauthorized"}), 401

    with _state_lock:
        r = _state["results"]
    if r is None:
        return jsonify({"error": "No scan results available"}), 400

    ws = r.get("worksheet")
    if ws is None:
        return jsonify({"error": "Sheet connection lost — re-run scan"}), 400

    diff_rows = r["diff_rows"]

    # Gate: any checked+flagged rows block the write
    blocking = [
        {"row_num": row["row_num"], "title": row["title"], "note": row["flag_note"]}
        for row in diff_rows
        if row.get("checked") and row.get("flagged")
    ]
    if blocking:
        return jsonify({
            "error": "Cannot write — flagged rows must be resolved or unchecked first",
            "blocking": blocking,
        }), 400

    # Build all cell updates for checked rows
    all_updates = []
    for row in diff_rows:
        if not row.get("checked"):
            continue
        all_updates.extend(_build_writes(row))

    if not all_updates:
        return jsonify({"ok": True, "cells_written": 0, "message": "Nothing to write — no scraped data available for checked rows."})

    count = batch_update(ws, all_updates)
    logger.info(f"Confirmed write: {count} cells updated")
    return jsonify({"ok": True, "cells_written": count})


# ── HTML Templates ─────────────────────────────────────────────────────────────

LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Inventory — Sign In</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cream:  #faf9f7; --cream-2: #f4f2ef;
      --gold-2: #b08928; --gold-3: #c9a84c; --gold-5: #f0e4bc;
      --text-1: #1c1608; --text-3: #7a6540; --text-4: #b09870;
      --border: rgba(176,137,40,0.18);
    }
    body { background: var(--cream); font-family: 'Inter', sans-serif; font-weight: 300;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .geo-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 1; overflow: hidden; }
    .card { position: relative; z-index: 1; text-align: center; max-width: 360px; width: 100%; padding: 3rem 2.5rem; }
    .eyebrow { font-size: 0.65rem; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gold-3); margin-bottom: 1.5rem; }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 2.4rem; font-weight: 300; letter-spacing: 0.1em; color: var(--text-1); margin-bottom: 0.5rem; }
    .sub { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--text-3); font-size: 1rem; margin-bottom: 2.5rem; }
    .divider { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin-bottom: 2rem; color: var(--gold-3); }
    .divider::before, .divider::after { content: ''; display: block; width: 40px; height: 1px; background: var(--gold-3); opacity: 0.5; }
    .divider-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold-3); }
    input[type=password] { width: 100%; padding: 0.85rem 1rem; border: 1px solid var(--border);
      background: var(--cream-2); color: var(--text-1); font-family: 'Inter', sans-serif;
      font-size: 0.88rem; font-weight: 300; letter-spacing: 0.05em; outline: none; margin-bottom: 1rem; }
    input[type=password]::placeholder { color: var(--text-4); }
    input[type=password]:focus { border-color: var(--gold-3); }
    button { width: 100%; padding: 0.85rem; background: transparent; border: 1px solid var(--border);
      color: var(--text-3); font-family: 'Inter', sans-serif; font-size: 0.72rem;
      font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
    button:hover { background: var(--cream-2); border-color: var(--gold-3); color: var(--gold-2); }
    .error { font-size: 0.75rem; color: #a03030; letter-spacing: 0.05em; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="geo-bg">
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs><g id="oct"><polygon points="0,-48 11.3,-11.3 48,0 11.3,11.3 0,48 -11.3,11.3 -48,0 -11.3,-11.3" fill="none" stroke="#b08928" stroke-width="0.6"/><circle cx="0" cy="0" r="48" fill="none" stroke="#b08928" stroke-width="0.4"/></g></defs>
      <g opacity="0.05"><use href="#oct" transform="translate(80,80) scale(1.4)"/><use href="#oct" transform="translate(calc(100vw - 80px),calc(100vh - 80px)) scale(1.2)"/></g>
    </svg>
  </div>
  <div class="card">
    <p class="eyebrow">Mokshatools · Content Inventory</p>
    <h1>INVENTORY</h1>
    <p class="sub">Access restricted</p>
    <div class="divider"><div class="divider-dot"></div></div>
    {% if error %}<p class="error">{{ error }}</p>{% endif %}
    <form method="POST">
      <input type="password" name="password" placeholder="Enter password" autofocus>
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>"""


DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Inventory — MOKSHATOOLS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cream:#faf9f7; --cream-2:#f4f2ef; --cream-3:#ede9e2;
      --gold-1:#7a5c1a; --gold-2:#b08928; --gold-3:#c9a84c; --gold-4:#e2c97e; --gold-5:#f0e4bc;
      --text-1:#1c1608; --text-2:#3a2e14; --text-3:#7a6540; --text-4:#b09870;
      --border:rgba(176,137,40,0.18); --border-2:rgba(176,137,40,0.08);
      --red:#a03030; --red-bg:rgba(160,48,48,0.07);
      --amber:#8a6a10; --amber-bg:rgba(138,106,16,0.08);
      --flag:#7a3030; --flag-bg:rgba(122,48,48,0.1);
    }
    html { scroll-behavior: smooth; }
    body { background: var(--cream); color: var(--text-1); font-family: 'Inter', sans-serif; font-weight: 300; min-height: 100vh; overflow-x: hidden; }
    .geo-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .container { position: relative; z-index: 1; max-width: 1280px; margin: 0 auto; padding: 0 2.5rem; }
    .divider { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin: 1.5rem 0; color: var(--gold-3); }
    .divider::before, .divider::after { content: ''; display: block; width: 50px; height: 1px; background: var(--gold-3); opacity: 0.5; }
    .divider-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold-3); }

    /* Header */
    .header { padding: 4rem 0 2rem; text-align: center; }
    .header-eyebrow { font-size: 0.65rem; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gold-3); margin-bottom: 1.2rem; }
    .header-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(2.5rem, 5vw, 4rem); font-weight: 300; letter-spacing: 0.1em; color: var(--text-1); margin-bottom: 0.5rem; }
    .header-sub { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--text-3); font-size: 1.1rem; }

    /* Controls */
    .controls { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 2.5rem; padding: 1.25rem 1.5rem; border: 1px solid var(--border); background: var(--cream-2); }
    .controls-left { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; }
    .channel-label { font-size: 0.62rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-4); }
    .channel-val { font-size: 0.78rem; color: var(--text-2); }
    .controls-right { display: flex; gap: 0.75rem; }
    .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.7rem 1.25rem;
           border: 1px solid var(--border); background: transparent; color: var(--text-3);
           font-family: 'Inter', sans-serif; font-size: 0.68rem; font-weight: 500;
           letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
    .btn:hover { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-2); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-1); }
    .btn-primary:hover { background: var(--gold-5); }
    .btn-confirm { background: rgba(176,137,40,0.12); border-color: var(--gold-3); color: var(--gold-1); font-size: 0.72rem; }
    .btn-confirm:hover { background: var(--gold-5); }
    .btn-sm { padding: 0.35rem 0.8rem; font-size: 0.6rem; }
    .btn-danger { border-color: var(--red); color: var(--red); }
    .btn-danger:hover { background: var(--red-bg); }

    /* Status */
    #status-strip { font-size: 0.72rem; letter-spacing: 0.08em; color: var(--text-4); padding: 0.4rem 0; min-height: 1.5rem; text-align: center; margin-bottom: 1rem; }
    #status-strip.scanning { color: var(--gold-3); }
    #status-strip.error { color: var(--red); }

    /* Stats */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); margin-bottom: 2.5rem; }
    .stat-card { background: var(--cream); padding: 1.25rem 1.5rem; }
    .stat-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); margin-bottom: 0.4rem; }
    .stat-num { font-family: 'Cormorant Garamond', serif; font-size: 2.2rem; font-weight: 300; color: var(--text-1); line-height: 1; }
    .stat-num.gap { color: var(--red); }
    .stat-num.amber { color: var(--amber); }

    /* Section Header */
    .section-header { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 1rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border); }
    .section-title { font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; font-weight: 400; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text-2); }
    .section-count { font-size: 0.62rem; letter-spacing: 0.12em; color: var(--text-4); }

    /* Filter Tabs */
    .filter-tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border: 1px solid var(--border); }
    .filter-tab { padding: 0.55rem 1.1rem; font-size: 0.65rem; font-weight: 500; letter-spacing: 0.15em;
                  text-transform: uppercase; cursor: pointer; background: transparent; border: none;
                  color: var(--text-4); transition: all 0.15s; border-right: 1px solid var(--border); }
    .filter-tab:last-child { border-right: none; }
    .filter-tab:hover { background: var(--cream-2); color: var(--text-2); }
    .filter-tab.active { background: var(--cream-2); color: var(--gold-2); }

    /* Table */
    .table-wrap { overflow-x: auto; margin-bottom: 2rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.79rem; }
    thead th { font-size: 0.58rem; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-4);
               padding: 0.75rem 0.9rem; text-align: left; background: var(--cream-2); border-bottom: 1px solid var(--border); white-space: nowrap; }
    thead th.center { text-align: center; }
    tbody tr { border-bottom: 1px solid var(--border-2); transition: background 0.15s; }
    tbody tr:hover { background: var(--cream-2); }
    tbody tr.hidden { display: none; }
    tbody tr.flagged-row { background: var(--flag-bg); }
    td { padding: 0.7rem 0.9rem; color: var(--text-2); vertical-align: top; }
    td.center { text-align: center; vertical-align: middle; }
    .select-col { width: 36px; text-align: center; vertical-align: middle; }
    input[type=checkbox] { accent-color: var(--gold-2); width: 14px; height: 14px; cursor: pointer; }

    /* Title cell */
    .title-main { font-size: 0.82rem; line-height: 1.4; color: var(--text-1); }
    .title-scraped { font-size: 0.68rem; color: var(--text-4); margin-top: 0.2rem; font-style: italic; }
    .title-scraped.mismatch { color: var(--amber); }
    .session-badge { display: inline-block; font-size: 0.58rem; font-weight: 500; letter-spacing: 0.1em;
                     padding: 0.15rem 0.45rem; background: var(--cream-3); border: 1px solid var(--border);
                     color: var(--text-4); margin-top: 0.25rem; }
    .session-badge.hh { background: var(--amber-bg); border-color: var(--amber); color: var(--amber); }

    /* Status Badges */
    .status { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.63rem;
              font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
    .status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .status-confirmed { color: var(--gold-2); }
    .status-confirmed::before { background: var(--gold-3); }
    .status-update { color: var(--gold-1); }
    .status-update::before { background: var(--gold-3); }
    .status-missing { color: var(--red); }
    .status-missing::before { background: var(--red); }
    .status-review { color: var(--amber); }
    .status-review::before { background: var(--gold-3); }
    .status-pending { color: var(--text-4); }
    .status-pending::before { background: var(--cream-3); border: 1px solid var(--border); }
    .status-not_scraped { color: var(--text-4); }
    .status-not_scraped::before { background: transparent; border: 1px solid var(--border); }
    .status-na { color: var(--text-4); font-style: italic; }
    .status-flagged { color: var(--flag); }
    .status-flagged::before { background: var(--flag); }
    .score-badge { font-size: 0.56rem; color: var(--text-4); margin-left: 0.15rem; }
    .action-link { font-size: 0.58rem; color: var(--gold-3); text-decoration: underline; text-underline-offset: 2px; margin-left: 0.3rem; }
    .action-link:hover { color: var(--gold-1); }
    .studio-flag { font-size: 0.6rem; color: var(--red); letter-spacing: 0.05em; }

    /* Flag button */
    .btn-flag { padding: 0.25rem 0.6rem; font-size: 0.58rem; font-weight: 500; letter-spacing: 0.1em;
                text-transform: uppercase; cursor: pointer; border: 1px solid var(--border);
                background: transparent; color: var(--text-4); transition: all 0.15s; }
    .btn-flag:hover { border-color: var(--flag); color: var(--flag); background: var(--flag-bg); }
    .btn-flag.active { border-color: var(--flag); color: var(--flag); background: var(--flag-bg); }
    .flag-note { font-size: 0.62rem; color: var(--flag); margin-top: 0.2rem; font-style: italic; }

    /* Confirm bar */
    #confirm-bar { display: none; position: sticky; bottom: 0; z-index: 50;
                   border-top: 1px solid var(--gold-4); background: var(--gold-5);
                   padding: 1rem 1.5rem; align-items: center; gap: 1rem; flex-wrap: wrap; }
    #confirm-bar.visible { display: flex; }
    #confirm-bar.blocked { background: var(--red-bg); border-color: var(--red); }
    .confirm-info { flex: 1; font-size: 0.72rem; color: var(--gold-1); letter-spacing: 0.04em; }
    .confirm-info.blocked { color: var(--red); }
    #blocking-list { font-size: 0.65rem; color: var(--red); margin-top: 0.25rem; }

    /* Chat correction */
    #chat-section { margin-top: 2rem; margin-bottom: 3rem; border: 1px solid var(--border); }
    .chat-header { padding: 0.9rem 1.25rem; background: var(--cream-2); border-bottom: 1px solid var(--border);
                   font-size: 0.65rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3); }
    .chat-body { padding: 1.25rem; display: flex; gap: 0.75rem; align-items: flex-start; }
    .chat-input { flex: 1; padding: 0.75rem 1rem; border: 1px solid var(--border); background: var(--cream);
                  color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.82rem; font-weight: 300;
                  outline: none; resize: vertical; min-height: 48px; }
    .chat-input::placeholder { color: var(--text-4); }
    .chat-input:focus { border-color: var(--gold-3); }
    .chat-feedback { padding: 0 1.25rem 1rem; font-size: 0.7rem; color: var(--text-4); min-height: 1.5rem; }
    .chat-feedback.ok { color: var(--gold-2); }
    .chat-feedback.error { color: var(--red); }
    .chat-disabled { padding: 1.25rem; font-size: 0.72rem; color: var(--text-4); font-style: italic; }

    /* Untracked */
    .untracked-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1px; background: var(--border-2); border: 1px solid var(--border-2); margin-bottom: 3rem; }
    .untracked-card { background: transparent; padding: 1rem 1.25rem; }
    .untracked-title { font-size: 0.78rem; color: var(--text-2); line-height: 1.4; margin-bottom: 0.3rem; }
    .untracked-date { font-size: 0.62rem; color: var(--text-4); letter-spacing: 0.05em; }
    .untracked-url { font-size: 0.6rem; color: var(--gold-3); }

    /* Loading */
    #loading { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(250,249,247,0.92); align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; }
    #loading.visible { display: flex; }
    .loading-title { font-family: 'Cormorant Garamond', serif; font-size: 2rem; font-weight: 300; letter-spacing: 0.15em; color: var(--text-2); }
    .loading-sub { font-size: 0.72rem; letter-spacing: 0.15em; color: var(--gold-3); text-transform: uppercase; }
    .loading-spinner { width: 48px; height: 48px; border: 1px solid var(--border); border-top-color: var(--gold-3); border-radius: 50%; animation: spin 1.2s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .empty-state { text-align: center; padding: 4rem 2rem; }
    .empty-title { font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; font-weight: 300; color: var(--text-3); margin-bottom: 0.5rem; }
    .empty-sub { font-size: 0.75rem; color: var(--text-4); letter-spacing: 0.1em; }

    footer { text-align: center; padding: 2.5rem 0 3rem; border-top: 1px solid var(--border-2); }
    footer p { font-size: 0.65rem; letter-spacing: 0.2em; color: var(--text-4); text-transform: uppercase; }
    footer a { color: var(--gold-3); text-decoration: none; }
    footer a:hover { color: var(--gold-2); }
  </style>
</head>
<body>

  <div class="geo-bg">
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <g id="octagram">
          <polygon points="0,-48 11.3,-11.3 48,0 11.3,11.3 0,48 -11.3,11.3 -48,0 -11.3,-11.3" fill="none" stroke="#b08928" stroke-width="0.6"/>
          <polygon points="0,-34 34,0 0,34 -34,0" fill="none" stroke="#b08928" stroke-width="0.5"/>
          <circle cx="0" cy="0" r="48" fill="none" stroke="#b08928" stroke-width="0.4"/>
          <circle cx="0" cy="0" r="34" fill="none" stroke="#b08928" stroke-width="0.3"/>
        </g>
        <g id="hexagram">
          <polygon points="0,-40 34.6,20 -34.6,20" fill="none" stroke="#b08928" stroke-width="0.6"/>
          <polygon points="0,40 34.6,-20 -34.6,-20" fill="none" stroke="#b08928" stroke-width="0.6"/>
          <circle cx="0" cy="0" r="40" fill="none" stroke="#b08928" stroke-width="0.4"/>
        </g>
      </defs>
      <g opacity="0.045">
        <use href="#octagram" transform="translate(130, 140) scale(1.5)"/>
        <use href="#hexagram"  transform="translate(260, 75) scale(0.9)"/>
        <use href="#octagram" transform="translate(calc(100vw - 140px), 110) scale(1.1)"/>
        <use href="#hexagram"  transform="translate(calc(100vw - 80px), calc(100vh - 180px)) scale(1.2)"/>
      </g>
    </svg>
  </div>

  <div id="loading">
    <div class="loading-spinner"></div>
    <div class="loading-title">Scanning</div>
    <div class="loading-sub" id="loading-msg">Initializing…</div>
  </div>

  <div class="container">

    <header class="header">
      <p class="header-eyebrow">Mokshatools &nbsp;·&nbsp; Content Ops &nbsp;·&nbsp; 2026</p>
      <div class="divider"><div class="divider-dot"></div></div>
      <h1 class="header-title">CONTENT INVENTORY</h1>
      <p class="header-sub">Platform gap analysis &amp; sheet sync</p>
      <div class="divider"><div class="divider-dot"></div></div>
    </header>

    <div class="controls">
      <div class="controls-left">
        <span class="channel-label">YouTube</span>
        <span class="channel-val">{{ yt_url or '— not configured —' }}</span>
        <span class="channel-label" style="margin-top:0.4rem;">TikTok</span>
        <span class="channel-val">{{ tt_url or '— not configured —' }}</span>
      </div>
      <div class="controls-right">
        {% if password_enabled %}
        <a href="/logout"><button class="btn btn-sm">Sign out</button></a>
        {% endif %}
        <button class="btn btn-primary" id="btn-scan" onclick="startScan()">&#9656; Scan Platforms</button>
      </div>
    </div>

    <div id="status-strip">
      {% if sheet_id %}Last scan: <span id="last-scan-time">—</span>{% else %}Configure .env to get started.{% endif %}
    </div>

    <div class="stats-grid" id="stats-grid" style="display:none;">
      <div class="stat-card"><div class="stat-label">In Sheet</div><div class="stat-num" id="stat-total">—</div></div>
      <div class="stat-card"><div class="stat-label">Live on YT</div><div class="stat-num" id="stat-yt-live">—</div></div>
      <div class="stat-card"><div class="stat-label">Live on TT</div><div class="stat-num" id="stat-tt-live">—</div></div>
      <div class="stat-card"><div class="stat-label">YT Gaps</div><div class="stat-num gap" id="stat-yt-gaps">—</div></div>
      <div class="stat-card"><div class="stat-label">TT Gaps</div><div class="stat-num gap" id="stat-tt-gaps">—</div></div>
      <div class="stat-card"><div class="stat-label">Studio Missing</div><div class="stat-num gap" id="stat-studio-flags">—</div></div>
      <div class="stat-card"><div class="stat-label">Untracked YT</div><div class="stat-num amber" id="stat-untracked-yt">—</div></div>
      <div class="stat-card"><div class="stat-label">Untracked TT</div><div class="stat-num amber" id="stat-untracked-tt">—</div></div>
    </div>

    <div id="results-section" style="display:none;">

      <div class="filter-tabs">
        <button class="filter-tab active" onclick="setFilter('all')">All</button>
        <button class="filter-tab" onclick="setFilter('update')">Needs Update</button>
        <button class="filter-tab" onclick="setFilter('missing')">Not Found</button>
        <button class="filter-tab" onclick="setFilter('review')">Review</button>
        <button class="filter-tab" onclick="setFilter('studio')">Studio Missing</button>
        <button class="filter-tab" onclick="setFilter('confirmed')">Confirmed</button>
        <button class="filter-tab" onclick="setFilter('flagged')">Flagged</button>
      </div>

      <div class="section-header">
        <span class="section-title">Video Inventory</span>
        <span class="section-count" id="row-count">—</span>
        <div style="margin-left:auto;display:flex;gap:0.5rem;">
          <button class="btn btn-sm" onclick="checkAll(true)">Check All</button>
          <button class="btn btn-sm" onclick="checkAll(false)">Uncheck All</button>
        </div>
      </div>

      <div class="table-wrap">
        <table id="results-table">
          <thead>
            <tr>
              <th class="select-col"><input type="checkbox" id="select-all" onchange="toggleAll(this)" title="Toggle all"></th>
              <th>Title &amp; Session</th>
              <th class="center">TikTok</th>
              <th class="center">IG / FB</th>
              <th class="center">YT Shorts</th>
              <th class="center">YT Studio</th>
              <th class="center">Flag</th>
            </tr>
          </thead>
          <tbody id="results-tbody"></tbody>
        </table>
      </div>

      <!-- Chat Correction -->
      <div id="chat-section">
        <div class="chat-header">Corrections — plain language</div>
        {% if chat_enabled %}
        <div class="chat-body">
          <textarea class="chat-input" id="chat-input" placeholder='e.g. "uncheck row 5" or "the TikTok title for Malaises is shortened, same video"' rows="2"></textarea>
          <button class="btn btn-sm btn-primary" onclick="sendCorrection()">Apply</button>
        </div>
        <div class="chat-feedback" id="chat-feedback"></div>
        {% else %}
        <div class="chat-disabled">Chat corrections require <code>OPENAI_API_KEY</code> in .env</div>
        {% endif %}
      </div>

      <!-- Untracked -->
      <div id="untracked-section" style="display:none;">
        <div class="section-header">
          <span class="section-title">Found on Platform — Not in Sheet</span>
          <span class="section-count" id="untracked-count"></span>
        </div>
        <div class="untracked-grid" id="untracked-yt-grid"></div>
        <div style="margin-top:1px;" class="untracked-grid" id="untracked-tt-grid"></div>
      </div>

    </div>

    <div id="empty-state" class="empty-state">
      <p class="empty-title">Run a scan to see your inventory</p>
      <p class="empty-sub">Click "Scan Platforms" to compare your sheet against live platform data.</p>
    </div>

    <footer>
      <div class="divider"><div class="divider-dot"></div></div>
      <p>Mokshatools &nbsp;·&nbsp; <a href="https://mokshatools.com">mokshatools.com</a> &nbsp;·&nbsp; 2026</p>
    </footer>

  </div>

  <!-- Sticky Confirm Bar -->
  <div id="confirm-bar">
    <div class="confirm-info" id="confirm-info">
      <span id="checked-count">0</span> rows selected for write
      <div id="blocking-list"></div>
    </div>
    <button class="btn btn-sm" onclick="checkAll(false)">Uncheck All</button>
    <button class="btn btn-confirm" id="btn-confirm" onclick="confirmWrite()">&#10003; Confirm &amp; Write to Sheet</button>
  </div>

  <script>
    // ── State ──────────────────────────────────────────────────────────────────
    let _results = null;
    let _pollTimer = null;
    let _currentFilter = 'all';

    // ── Scan ───────────────────────────────────────────────────────────────────
    async function startScan() {
      const btn = document.getElementById('btn-scan');
      btn.disabled = true;
      showLoading('Initializing…');
      const res = await fetch('/api/scan', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json();
        hideLoading(); setStatus('error', d.error || 'Failed to start scan');
        btn.disabled = false; return;
      }
      pollStatus();
    }

    function pollStatus() {
      _pollTimer = setInterval(async () => {
        const res = await fetch('/api/status');
        const d = await res.json();
        document.getElementById('loading-msg').textContent = d.progress || 'Working…';
        if (d.last_scan) document.getElementById('last-scan-time').textContent = d.last_scan;
        if (d.status === 'done') {
          clearInterval(_pollTimer); hideLoading();
          document.getElementById('btn-scan').disabled = false;
          setStatus('', 'Scan complete — ' + d.last_scan);
          loadResults();
        } else if (d.status === 'error') {
          clearInterval(_pollTimer); hideLoading();
          document.getElementById('btn-scan').disabled = false;
          setStatus('error', 'Scan error: ' + (d.error || 'Unknown'));
        }
      }, 1500);
    }

    async function loadResults() {
      const res = await fetch('/api/results');
      if (!res.ok) return;
      _results = await res.json();
      renderStats(_results.stats);
      renderTable(_results.diff_rows);
      renderUntracked(_results.untracked_yt, _results.untracked_tt);
      document.getElementById('stats-grid').style.display = '';
      document.getElementById('results-section').style.display = '';
      document.getElementById('empty-state').style.display = 'none';
      syncConfirmBar();
    }

    // ── Render ─────────────────────────────────────────────────────────────────
    function renderStats(s) {
      document.getElementById('stat-total').textContent        = s.total_in_sheet;
      document.getElementById('stat-yt-live').textContent      = s.yt_videos_live;
      document.getElementById('stat-tt-live').textContent      = s.tt_videos_live;
      document.getElementById('stat-yt-gaps').textContent      = s.yt_gaps;
      document.getElementById('stat-tt-gaps').textContent      = s.tt_gaps;
      document.getElementById('stat-studio-flags').textContent = s.studio_flags;
      document.getElementById('stat-untracked-yt').textContent  = s.untracked_yt;
      document.getElementById('stat-untracked-tt').textContent  = s.untracked_tt;
    }

    const STATUS_LABELS = {
      confirmed: 'Published', update: 'Found — update sheet', missing: 'Not found',
      review: 'Review match', pending: 'Not posted', not_scraped: '—',
    };

    function statusBadge(action, score, matchUrl, scrapedTitle) {
      const label = STATUS_LABELS[action] || action;
      const scoreHtml = (action === 'review') ? `<span class="score-badge">${score}%</span>` : '';
      const urlHtml = matchUrl ? `<a href="${matchUrl}" target="_blank" class="action-link">↗</a>` : '';
      return `<span class="status status-${action}">${label}${scoreHtml}</span>${urlHtml}`;
    }

    function renderTable(rows) {
      const tbody = document.getElementById('results-tbody');
      tbody.innerHTML = '';
      rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.dataset.rowNum    = row.row_num;
        tr.dataset.ttAction  = row.tt_action;
        tr.dataset.ytAction  = row.yt_action;
        tr.dataset.studioFlag = row.yt_studio_flagged ? '1' : '0';
        tr.dataset.flagged   = row.flagged ? '1' : '0';
        if (row.flagged) tr.classList.add('flagged-row');

        // Title block
        const sessionClass = row.is_hh ? 'hh' : '';
        const hasTtMismatch = row.tt_scraped_title && row.tt_scraped_title.toLowerCase() !== row.title.toLowerCase();
        const ttScrapedHtml = row.tt_scraped_title
          ? `<div class="title-scraped ${hasTtMismatch ? 'mismatch' : ''}">TT: ${esc(row.tt_scraped_title)}</div>` : '';
        const hasYtMismatch = row.yt_scraped_title && row.yt_scraped_title.toLowerCase() !== row.title.toLowerCase();
        const ytScrapedHtml = row.yt_scraped_title
          ? `<div class="title-scraped ${hasYtMismatch ? 'mismatch' : ''}">YT: ${esc(row.yt_scraped_title)}</div>` : '';

        // IG/FB
        const fbHtml = row.fb_published
          ? `<span class="status status-confirmed">Published</span>${row.fb_date_sheet ? `<br><span style="font-size:0.6rem;color:var(--text-4)">${esc(row.fb_date_sheet)}</span>` : ''}`
          : `<span class="status status-not_scraped">—</span>`;

        // YT Studio
        let studioHtml;
        if (row.is_hh) {
          studioHtml = `<span class="status status-na">N/A — Handheld</span>`;
        } else if (row.yt_studio_url) {
          studioHtml = `<a href="${esc(row.yt_studio_url)}" target="_blank" class="status status-confirmed">Uploaded ↗</a>`;
        } else {
          studioHtml = `<span class="studio-flag">&#9679; Missing</span>`;
        }

        // Flag button
        const flagActive = row.flagged ? 'active' : '';
        const flagLabel  = row.flagged ? 'Unflag' : 'Flag';
        const flagNoteHtml = row.flag_note ? `<div class="flag-note">${esc(row.flag_note)}</div>` : '';

        tr.innerHTML = `
          <td class="select-col">
            <input type="checkbox" class="row-cb" data-row="${row.row_num}" ${row.checked ? 'checked' : ''} onchange="onRowCheck(this)">
          </td>
          <td>
            <div class="title-main">${esc(row.title)}</div>
            ${ttScrapedHtml}${ytScrapedHtml}
            <div class="session-badge ${sessionClass}">${esc(row.session_type)}</div>
          </td>
          <td class="center">
            ${statusBadge(row.tt_action, row.tt_match_score, row.tt_match_url)}
            ${row.tt_scraped_date ? `<br><span style="font-size:0.6rem;color:var(--text-4)">${esc(row.tt_scraped_date)}</span>` : ''}
          </td>
          <td class="center">${fbHtml}</td>
          <td class="center">
            ${statusBadge(row.yt_action, row.yt_match_score, row.yt_match_url)}
            ${row.yt_scraped_date ? `<br><span style="font-size:0.6rem;color:var(--text-4)">${esc(row.yt_scraped_date)}</span>` : ''}
            ${row.yt_status_sheet ? `<br><span style="font-size:0.6rem;color:var(--text-4)">${esc(row.yt_status_sheet)}</span>` : ''}
          </td>
          <td class="center">${studioHtml}</td>
          <td class="center">
            <button class="btn-flag ${flagActive}" onclick="toggleFlag(${row.row_num}, this)">${flagLabel}</button>
            ${flagNoteHtml}
          </td>
        `;

        tbody.appendChild(tr);
      });
      updateRowCount();
    }

    function renderUntracked(ytVideos, ttVideos) {
      const section = document.getElementById('untracked-section');
      if (!ytVideos.length && !ttVideos.length) { section.style.display = 'none'; return; }
      section.style.display = '';
      document.getElementById('untracked-count').textContent = `${ytVideos.length} YT · ${ttVideos.length} TT`;
      document.getElementById('untracked-yt-grid').innerHTML = ytVideos.map(v => `
        <div class="untracked-card">
          <div class="untracked-title">${esc(v.title)}</div>
          <div class="untracked-date">YouTube${v.upload_date ? ' · ' + v.upload_date : ''}</div>
          ${v.url ? `<a href="${v.url}" target="_blank" class="untracked-url">↗ Open</a>` : ''}
        </div>`).join('');
      document.getElementById('untracked-tt-grid').innerHTML = ttVideos.map(v => `
        <div class="untracked-card">
          <div class="untracked-title">${esc(v.title)}</div>
          <div class="untracked-date">TikTok${v.upload_date ? ' · ' + v.upload_date : ''}</div>
          ${v.url ? `<a href="${v.url}" target="_blank" class="untracked-url">↗ Open</a>` : ''}
        </div>`).join('');
    }

    // ── Filtering ──────────────────────────────────────────────────────────────
    function setFilter(f) {
      _currentFilter = f;
      document.querySelectorAll('.filter-tab').forEach(el => {
        el.classList.toggle('active', el.getAttribute('onclick').includes(`'${f}'`));
      });
      document.querySelectorAll('#results-tbody tr').forEach(tr => {
        let show = true;
        if (f === 'update')    show = ['update','review'].includes(tr.dataset.ttAction) || ['update','review'].includes(tr.dataset.ytAction);
        if (f === 'missing')   show = tr.dataset.ttAction === 'missing' || tr.dataset.ytAction === 'missing';
        if (f === 'review')    show = tr.dataset.ttAction === 'review' || tr.dataset.ytAction === 'review';
        if (f === 'studio')    show = tr.dataset.studioFlag === '1';
        if (f === 'confirmed') show = tr.dataset.ttAction === 'confirmed' || tr.dataset.ytAction === 'confirmed';
        if (f === 'flagged')   show = tr.dataset.flagged === '1';
        tr.classList.toggle('hidden', !show);
      });
      updateRowCount();
    }

    function updateRowCount() {
      const visible = document.querySelectorAll('#results-tbody tr:not(.hidden)').length;
      document.getElementById('row-count').textContent = visible + ' videos';
    }

    // ── Selection ──────────────────────────────────────────────────────────────
    function onRowCheck(cb) {
      const rowNum = +cb.dataset.row;
      // Update local results state
      if (_results) {
        const row = _results.diff_rows.find(r => r.row_num === rowNum);
        if (row) row.checked = cb.checked;
      }
      // Sync to server
      fetch('/api/check', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({row_nums: [rowNum], checked: cb.checked}),
      });
      syncConfirmBar();
    }

    function toggleAll(selectAll) {
      document.querySelectorAll('#results-tbody tr:not(.hidden) .row-cb').forEach(cb => {
        cb.checked = selectAll.checked;
        onRowCheck(cb);
      });
    }

    function checkAll(checked) {
      document.querySelectorAll('#results-tbody .row-cb').forEach(cb => {
        cb.checked = checked;
        onRowCheck(cb);
      });
      document.getElementById('select-all').checked = checked;
    }

    function syncConfirmBar() {
      if (!_results) return;
      const bar = document.getElementById('confirm-bar');
      const checkedRows = _results.diff_rows.filter(r => r.checked);
      const blocking = checkedRows.filter(r => r.flagged);

      document.getElementById('checked-count').textContent = checkedRows.length;
      bar.classList.toggle('visible', checkedRows.length > 0);
      bar.classList.toggle('blocked', blocking.length > 0);

      const info = document.getElementById('confirm-info');
      info.classList.toggle('blocked', blocking.length > 0);

      const blockList = document.getElementById('blocking-list');
      if (blocking.length > 0) {
        blockList.textContent = `${blocking.length} flagged row(s) must be resolved or unchecked: ` +
          blocking.map(r => `row ${r.row_num}`).join(', ');
      } else {
        blockList.textContent = '';
      }
    }

    // ── Flag ───────────────────────────────────────────────────────────────────
    async function toggleFlag(rowNum, btn) {
      const isFlagged = btn.classList.contains('active');
      let note = '';
      if (!isFlagged) {
        note = prompt("Optional: describe why you're flagging this row (or leave blank)") || '';
      }
      const res = await fetch('/api/flag', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({row_num: rowNum, flagged: !isFlagged, note}),
      });
      const d = await res.json();
      if (!d.ok) return;

      btn.classList.toggle('active', !isFlagged);
      btn.textContent = isFlagged ? 'Flag' : 'Unflag';
      const tr = btn.closest('tr');
      tr.dataset.flagged = isFlagged ? '0' : '1';
      tr.classList.toggle('flagged-row', !isFlagged);

      // Update flag note display
      let noteEl = tr.querySelector('.flag-note');
      if (!isFlagged && note) {
        if (!noteEl) { noteEl = document.createElement('div'); noteEl.className = 'flag-note'; btn.after(noteEl); }
        noteEl.textContent = note;
      } else if (noteEl) {
        noteEl.remove();
      }

      // Update local state
      if (_results) {
        const row = _results.diff_rows.find(r => r.row_num === rowNum);
        if (row) { row.flagged = !isFlagged; row.flag_note = note; }
      }
      syncConfirmBar();
    }

    // ── Chat Correction ────────────────────────────────────────────────────────
    async function sendCorrection() {
      const input = document.getElementById('chat-input');
      const instruction = input.value.trim();
      if (!instruction) return;

      const fb = document.getElementById('chat-feedback');
      fb.textContent = 'Applying…'; fb.className = 'chat-feedback';

      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({instruction}),
      });
      const d = await res.json();

      if (!d.ok) {
        fb.textContent = d.error || 'Error applying correction'; fb.className = 'chat-feedback error'; return;
      }

      fb.textContent = `Applied ${d.ops_applied} change(s). Refreshing…`; fb.className = 'chat-feedback ok';
      input.value = '';

      // Reload results to reflect changes
      await loadResults();
      if (_currentFilter !== 'all') setFilter(_currentFilter);
    }

    // ── Confirm & Write ────────────────────────────────────────────────────────
    async function confirmWrite() {
      const btn = document.getElementById('btn-confirm');
      btn.disabled = true;

      const res = await fetch('/api/confirm', { method: 'POST' });
      const d = await res.json();
      btn.disabled = false;

      if (d.ok) {
        setStatus('', `Sheet updated — ${d.cells_written} cells written.`);
        document.getElementById('confirm-bar').classList.remove('visible');
        setTimeout(startScan, 800);
      } else {
        setStatus('error', d.error || 'Write failed');
        if (d.blocking) {
          const names = d.blocking.map(b => `row ${b.row_num} (${b.title})`).join(', ');
          setStatus('error', `Cannot write — resolve or uncheck flagged rows: ${names}`);
        }
      }
    }

    // ── UI Helpers ─────────────────────────────────────────────────────────────
    function showLoading(msg) {
      document.getElementById('loading-msg').textContent = msg;
      document.getElementById('loading').classList.add('visible');
    }
    function hideLoading() { document.getElementById('loading').classList.remove('visible'); }
    function setStatus(type, msg) {
      const el = document.getElementById('status-strip');
      el.textContent = msg; el.className = type;
    }
    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Chat input: submit on Enter (not Shift+Enter)
    document.addEventListener('DOMContentLoaded', () => {
      const inp = document.getElementById('chat-input');
      if (inp) inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCorrection(); }
      });
    });
  </script>
</body>
</html>"""


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"Content Inventory Tool v2 — http://localhost:{config.PORT}")
    logger.info(f"YouTube  : {config.YOUTUBE_CHANNEL_URL or 'NOT SET'}")
    logger.info(f"TikTok   : {config.TIKTOK_CHANNEL_URL  or 'NOT SET'}")
    logger.info(f"Sheet ID : {config.GOOGLE_SHEET_ID     or 'NOT SET'}")
    logger.info(f"Chat AI  : {'enabled' if config.OPENAI_API_KEY else 'disabled (no OPENAI_API_KEY)'}")
    app.run(host="0.0.0.0", port=config.PORT, debug=False)
