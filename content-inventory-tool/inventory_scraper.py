"""
inventory_scraper.py — Pull video lists from YouTube and TikTok via yt-dlp.
Returns normalized dicts: {id, title, url, upload_date, platform}
"""

import re
import shutil
import subprocess
import logging

logger = logging.getLogger(__name__)

_YTDLP = shutil.which('yt-dlp') or '/Users/robertsinclair/Library/Python/3.9/bin/yt-dlp'

_TT_HANDLE_RE = re.compile(r'tiktok\.com/(@[^/?#]+)')


def _make_url(platform: str, video_id: str, channel_url: str = "") -> str:
    """Construct a canonical video URL from platform + ID."""
    if platform == "youtube":
        return f"https://www.youtube.com/watch?v={video_id}"
    if platform == "tiktok":
        m = _TT_HANDLE_RE.search(channel_url)
        handle = m.group(1) if m else "@unknown"
        return f"https://www.tiktok.com/{handle}/video/{video_id}"
    return ""


def _format_date(raw: str) -> str:
    """Convert yt-dlp YYYYMMDD to YYYY-MM-DD, or return raw if already formatted/empty."""
    if not raw or raw in ("NA", "none", "None"):
        return ""
    raw = raw.strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return raw


def _run_ytdlp(url: str, platform: str, extra_args: list = None) -> list[dict]:
    """Core yt-dlp call. Returns list of video dicts or [] on failure."""
    if not url:
        return []

    cmd = [
        _YTDLP,
        "--flat-playlist",
        "--print", "%(id)s\t%(title)s\t%(upload_date,)s",
        "--no-warnings",
        "--quiet",
    ]
    if extra_args:
        cmd.extend(extra_args)
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode != 0 and result.stderr:
            logger.warning(f"yt-dlp stderr ({platform}): {result.stderr[:300]}")

        videos = []
        for line in result.stdout.strip().splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            vid_id = parts[0].strip() if len(parts) > 0 else ""
            title  = parts[1].strip() if len(parts) > 1 else ""
            date   = _format_date(parts[2].strip() if len(parts) > 2 else "")
            if not vid_id:
                continue
            videos.append({
                "id":          vid_id,
                "title":       title,
                "upload_date": date,
                "url":         _make_url(platform, vid_id, url),
                "platform":    platform,
            })

        logger.info(f"Scraped {len(videos)} videos from {platform}")
        return videos

    except subprocess.TimeoutExpired:
        logger.error(f"Timeout scraping {platform}: {url}")
        return []
    except FileNotFoundError:
        logger.error("yt-dlp not found. Install with: pip install yt-dlp")
        return []
    except Exception as e:
        logger.error(f"Error scraping {platform}: {e}")
        return []


def scrape_youtube(url: str) -> list[dict]:
    """Pull Shorts video list from a YouTube channel (/shorts tab)."""
    shorts_url = url.rstrip("/") + "/shorts"
    return _run_ytdlp(shorts_url, "youtube")


def scrape_tiktok(url: str) -> list[dict]:
    """
    Pull video list from a TikTok channel via yt-dlp.

    Note: TikTok may block scraping without cookies. If this returns empty:
      1. Try adding cookies: yt-dlp --cookies-from-browser chrome [url]
      2. Set TIKTOK_COOKIES_FILE in .env and uncomment the cookies line below.
    """
    videos = _run_ytdlp(url, "tiktok")

    if not videos:
        logger.warning(
            "TikTok returned no results. If the channel is public, try passing cookies:\n"
            "  Set TIKTOK_COOKIES_FILE in .env and uncomment the cookies line in scrape_tiktok().\n"
            "  yt-dlp --cookies cookies.txt [url]"
        )
        # Uncomment and set TIKTOK_COOKIES_FILE in .env to use cookies:
        # import os
        # cookies = os.getenv("TIKTOK_COOKIES_FILE")
        # if cookies:
        #     videos = _run_ytdlp(url, "tiktok", extra_args=["--cookies", cookies])

    return videos
