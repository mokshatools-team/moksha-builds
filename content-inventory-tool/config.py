import os
from dotenv import load_dotenv

load_dotenv()

# ── Infrastructure (stays in .env) ─────────────────────────────────────────────
YOUTUBE_CHANNEL_URL  = os.getenv("YOUTUBE_CHANNEL_URL", "")
TIKTOK_CHANNEL_URL   = os.getenv("TIKTOK_CHANNEL_URL", "")
GOOGLE_SHEET_ID      = os.getenv("GOOGLE_SHEET_ID", "")
GOOGLE_CREDS_JSON    = os.getenv("GOOGLE_CREDS_JSON", "credentials.json")
SHEET_WORKSHEET_NAME = os.getenv("SHEET_WORKSHEET_NAME", "TT CONTENT").strip()
SHEET_CONFIG_TAB     = os.getenv("SHEET_CONFIG_TAB", "CONFIG").strip()
INVENTORY_PASSWORD   = os.getenv("INVENTORY_PASSWORD", "")
PORT                 = int(os.getenv("PORT", "4100"))
OPENAI_API_KEY       = os.getenv("OPENAI_API_KEY", "")

# ── Column name fallbacks (used when CONFIG tab is missing or incomplete) ───────
# Keys match the "Function" column in the CONFIG tab exactly.
COL_DEFAULTS = {
    "Title Column":             os.getenv("SHEET_TITLE_COL",      "TITLE"),
    "Session Column":           os.getenv("SHEET_SESSION_COL",    "SESSION #"),
    "YT Studio Column":         os.getenv("SHEET_YT_STUDIO_COL",  "YOUTUBE LINK"),
    "TikTok Date Column":       os.getenv("SHEET_TT_DATE_COL",    "TikTok Date"),
    "IG/FB Date Column":        os.getenv("SHEET_FB_DATE_COL",    "IG/FB Date"),
    "YT Shorts Status Column":  os.getenv("SHEET_YT_STATUS_COL",  "YT Shorts Status"),
    "YT Shorts Title Column":   os.getenv("SHEET_YT_TITLE_COL",   "YT Shorts Title"),
    "YT Shorts Date Column":    os.getenv("SHEET_YT_DATE_COL",    "YT Shorts Date"),
}
