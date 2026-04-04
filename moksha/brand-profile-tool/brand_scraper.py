#!/usr/bin/env python3
"""
brand_scraper.py — Scrape YouTube, website, and Instagram for brand profile data.
"""

import io
import json
import logging
import re
import subprocess
import urllib.request
import warnings
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

YTDLP   = "/opt/homebrew/bin/yt-dlp"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


# ── YouTube ─────────────────────────────────────────────────────────────────

def scrape_youtube(channel_url: str) -> dict:
    """Scrape channel info + 10 most recent videos via yt-dlp."""
    try:
        videos_url = channel_url.rstrip("/") + "/videos"

        # Run three calls in parallel: metadata, recent videos, total video count
        import threading

        meta_result_box    = [None]
        videos_result_box  = [None]
        count_result_box   = [None]

        def _meta():
            meta_result_box[0] = subprocess.run(
                [YTDLP, "--dump-single-json", "--no-warnings", "--playlist-items", "0", channel_url],
                capture_output=True, text=True, timeout=60,
            )

        def _videos():
            videos_result_box[0] = subprocess.run(
                [YTDLP, "--dump-json", "--no-warnings", "--playlist-items", "1:10", "--flat-playlist", channel_url],
                capture_output=True, text=True, timeout=90,
            )

        def _count():
            # Count all content across /videos, /shorts, and /streams tabs
            total = 0
            for tab in ("videos", "shorts", "streams"):
                r = subprocess.run(
                    [YTDLP, "--flat-playlist", "--no-warnings", "--print", "id",
                     channel_url.rstrip("/") + f"/{tab}"],
                    capture_output=True, text=True, timeout=90,
                )
                if r.returncode == 0:
                    ids = [l for l in r.stdout.strip().splitlines() if l.strip()]
                    total += len(ids)
            count_result_box[0] = total

        threads = [threading.Thread(target=f) for f in (_meta, _videos, _count)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=100)

        # Parse metadata
        channel_data = {}
        if meta_result_box[0] and meta_result_box[0].returncode == 0 and meta_result_box[0].stdout.strip():
            raw = json.loads(meta_result_box[0].stdout.strip())
            channel_data = {
                "subscriber_count":  raw.get("channel_follower_count"),
                "channel_description": (raw.get("description") or "")[:500],
                "channel_name":      raw.get("channel") or raw.get("uploader"),
            }

        # Real video count (videos + shorts + streams)
        channel_data["video_count"] = count_result_box[0] if count_result_box[0] else None

        # Recent videos
        recent_videos = []
        if videos_result_box[0] and videos_result_box[0].returncode == 0:
            for line in videos_result_box[0].stdout.strip().splitlines():
                try:
                    v = json.loads(line)
                    recent_videos.append({
                        "title":       v.get("title", ""),
                        "view_count":  v.get("view_count"),
                        "upload_date": v.get("upload_date", ""),
                        "url":         v.get("url") or v.get("webpage_url", ""),
                        "duration":    v.get("duration"),
                    })
                except json.JSONDecodeError:
                    continue

        return {**channel_data, "recent_videos": recent_videos}

    except Exception as e:
        logger.warning(f"YouTube scrape failed: {e}")
        return {"recent_videos": []}


# ── Website ──────────────────────────────────────────────────────────────────

def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"{r:02X}{g:02X}{b:02X}"


def _color_is_skip(r: int, g: int, b: int) -> bool:
    """Return True for near-white, near-black, and obvious plugin/framework colors."""
    # Near white
    if r > 235 and g > 235 and b > 235:
        return True
    # Near black
    if r < 20 and g < 20 and b < 20:
        return True
    # Plugin greens: g channel dominates (WhatsApp #25D366, Stripe, etc.)
    if g > r + 60 and g > b + 50 and g > 130:
        return True
    # Plugin blues: b dominates with low r and g (PayPal, links)
    if b > 160 and r < 70 and g < 100:
        return True
    return False


def _colors_too_similar(r1: int, g1: int, b1: int, r2: int, g2: int, b2: int,
                         threshold: int = 40) -> bool:
    return abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2) < threshold


def _extract_colors_from_css(soup: BeautifulSoup) -> list[tuple[int, int, int]]:
    """
    Extract colors from inline <style> blocks and inline style attributes only.
    Only looks at CSS *property contexts* to avoid picking up hex strings in JS.
    Returns list of (r, g, b) tuples with count weights.
    """
    CSS_PROPS = re.compile(
        r'(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|'
        r'outline(?:-color)?|box-shadow|text-shadow|--[\w-]+)\s*:[^;}{]*?'
        r'(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\))',
        re.IGNORECASE
    )

    counts: dict[tuple[int, int, int], int] = {}

    def _add(r: int, g: int, b: int):
        if not _color_is_skip(r, g, b):
            key = (round(r / 8) * 8, round(g / 8) * 8, round(b / 8) * 8)
            counts[key] = counts.get(key, 0) + 1

    def _scan(css: str):
        for m in CSS_PROPS.finditer(css):
            val = m.group(1)
            if val.startswith("#"):
                h = val[1:]
                if len(h) == 3:
                    h = h[0]*2 + h[1]*2 + h[2]*2
                if len(h) == 6:
                    _add(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
            else:
                nums = re.findall(r'\d+', val)
                if len(nums) >= 3:
                    _add(int(nums[0]), int(nums[1]), int(nums[2]))

    for tag in soup.find_all("style"):
        _scan(tag.get_text())
    for tag in soup.find_all(style=True):
        _scan(tag["style"])

    return [(rgb, cnt) for rgb, cnt in counts.items()]


def _extract_image_colors(image_url: str, max_colors: int = 6) -> list[tuple[int, int, int]]:
    """
    Download an image and extract dominant colors using PIL quantization.
    Returns list of (r, g, b) tuples, most dominant first.
    """
    try:
        from PIL import Image
        req = urllib.request.Request(image_url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = resp.read()
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((200, 200))
        # Quantize to palette
        quantized = img.quantize(colors=16, method=2)  # FASTOCTREE
        palette_raw = quantized.getpalette()[:16 * 3]
        color_counts = sorted(quantized.getcolors(maxcolors=40000) or [], key=lambda x: -x[0])
        results = []
        seen: list[tuple[int, int, int]] = []
        for count, idx in color_counts:
            r, g, b = palette_raw[idx*3], palette_raw[idx*3+1], palette_raw[idx*3+2]
            if _color_is_skip(r, g, b):
                continue
            # Skip if too close to an already-added color
            if any(_colors_too_similar(r, g, b, pr, pg, pb, 50) for pr, pg, pb in seen):
                continue
            results.append((r, g, b))
            seen.append((r, g, b))
            if len(results) >= max_colors:
                break
        return results
    except Exception as e:
        logger.debug(f"Image color extraction failed for {image_url}: {e}")
        return []


def _extract_colors(soup: BeautifulSoup, html_text: str, base_url: str = "") -> list[str]:
    """
    Extract brand colors from two sources and merge:
    1. CSS property contexts in inline <style> blocks (picks up defined brand colors)
    2. Dominant colors sampled from the og:image (picks up image-based palettes)
    """
    all_colors: dict[tuple[int, int, int], int] = {}

    # Source 1: CSS (lower weight, can contain framework defaults)
    for rgb, cnt in _extract_colors_from_css(soup):
        all_colors[rgb] = all_colors.get(rgb, 0) + cnt

    # Source 2: og:image dominant colors (high weight — this IS the visual brand)
    og = soup.select_one('meta[property="og:image"]')
    if og and og.get("content"):
        for r, g, b in _extract_image_colors(og["content"]):
            key = (round(r/8)*8, round(g/8)*8, round(b/8)*8)
            all_colors[key] = all_colors.get(key, 0) + 20  # strong weight

    # Also try the apple-touch-icon (often the logo color)
    icon = soup.find("link", rel="apple-touch-icon") or soup.find("link", rel="apple-touch-icon-precomposed")
    if icon and icon.get("href") and base_url:
        for r, g, b in _extract_image_colors(urljoin(base_url, icon["href"]), max_colors=3):
            key = (round(r/8)*8, round(g/8)*8, round(b/8)*8)
            all_colors[key] = all_colors.get(key, 0) + 10

    # Sort by weight and de-duplicate similar colors
    sorted_all = sorted(all_colors.items(), key=lambda x: -x[1])
    final: list[str] = []
    seen: list[tuple[int, int, int]] = []
    for (r, g, b), _ in sorted_all:
        if any(_colors_too_similar(r, g, b, pr, pg, pb, 40) for pr, pg, pb in seen):
            continue
        final.append(f"#{_rgb_to_hex(r, g, b)}")
        seen.append((r, g, b))
        if len(final) >= 8:
            break

    return final


def _extract_fonts(html_text: str) -> list[str]:
    """Extract font-family names from CSS."""
    pattern = re.compile(r'font-family\s*:\s*([^;}{]+)', re.IGNORECASE)
    fonts = []
    seen = set()
    for match in pattern.finditer(html_text):
        raw = match.group(1).strip()
        # Take first named font, strip quotes and fallbacks
        first = raw.split(",")[0].strip().strip("'\"")
        if first and first.lower() not in ("sans-serif", "serif", "monospace", "inherit", "initial", "unset") and first not in seen:
            seen.add(first)
            fonts.append(first)
            if len(fonts) >= 4:
                break
    return fonts


def _find_logo_url(soup: BeautifulSoup, base_url: str) -> str:
    """
    Find the brand logo URL. Priority:
    1. apple-touch-icon (most reliable — sites set this to their actual logo)
    2. link[rel=icon] with png/svg
    3. <img> with 'logo' in alt, class, id, or src
    4. og:image (last resort — usually a social banner, not a logo)
    """
    # 1. Apple touch icon
    for rel in ("apple-touch-icon", "apple-touch-icon-precomposed"):
        tag = soup.find("link", rel=rel)
        if tag and tag.get("href"):
            return urljoin(base_url, tag["href"])

    # 2. Favicon that's a PNG/SVG (not ICO — those are tiny)
    for tag in soup.find_all("link", rel=lambda r: r and "icon" in r):
        href = tag.get("href", "")
        if href and any(href.lower().endswith(ext) for ext in (".png", ".svg", ".webp")):
            return urljoin(base_url, href)

    # 3. img tag with logo in attributes
    for img in soup.find_all("img"):
        src = img.get("src", "")
        combined = " ".join([
            img.get("alt", ""),
            " ".join(img.get("class", [])),
            img.get("id", ""),
            src,
        ]).lower()
        if "logo" in combined and src:
            return urljoin(base_url, src)

    # 4. og:image fallback
    og = soup.select_one('meta[property="og:image"]')
    if og and og.get("content"):
        return og["content"]

    return ""


def scrape_website(url: str) -> dict:
    """Scrape brand colors, fonts, meta copy, and logo from a website."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = requests.get(url, headers=HEADERS, timeout=15, verify=False)
        resp.raise_for_status()
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        # Meta description
        meta_desc = ""
        for sel in ['meta[name="description"]', 'meta[property="og:description"]']:
            tag = soup.select_one(sel)
            if tag and tag.get("content"):
                meta_desc = tag["content"].strip()
                break

        logo_url = _find_logo_url(soup, url)

        # Page title
        title = ""
        if soup.title:
            title = soup.title.string or ""

        colors = _extract_colors(soup, html, base_url=url)
        fonts  = _extract_fonts(html)

        return {
            "colors":           colors,
            "fonts":            fonts,
            "meta_description": meta_desc,
            "logo_url":         logo_url,
            "page_title":       title.strip(),
        }

    except Exception as e:
        logger.warning(f"Website scrape failed for {url}: {e}")
        return {"colors": [], "fonts": [], "meta_description": "", "logo_url": "", "page_title": ""}


# ── Instagram ────────────────────────────────────────────────────────────────

def scrape_instagram(handle: str) -> dict:
    """Best-effort public Instagram profile scrape. Silently returns {} on failure."""
    try:
        handle = handle.lstrip("@")
        url = f"https://www.instagram.com/{handle}/"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return {}
        html = resp.text

        # IG embeds profile data in a JSON blob
        match = re.search(r'"edge_followed_by":\{"count":(\d+)\}', html)
        followers = int(match.group(1)) if match else None

        match = re.search(r'"edge_owner_to_timeline_media":\{"count":(\d+)', html)
        posts = int(match.group(1)) if match else None

        match = re.search(r'"biography":"(.*?)"', html)
        bio = match.group(1).replace("\\n", " ").replace('\\"', '"') if match else ""

        if not any([followers, posts, bio]):
            return {}

        return {"follower_count": followers, "post_count": posts, "bio": bio}

    except Exception as e:
        logger.debug(f"Instagram scrape skipped: {e}")
        return {}


# ── Full Sweep ───────────────────────────────────────────────────────────────

def scrape_all(profile: dict) -> dict:
    """
    Run all three scrapers. Returns a dict with keys: youtube, website, instagram.
    Each value is the scraper result (empty dict on failure).
    """
    import threading

    results = {"youtube": {}, "website": {}, "instagram": {}}

    def _yt():
        if profile.get("youtube_url"):
            results["youtube"] = scrape_youtube(profile["youtube_url"])

    def _web():
        if profile.get("website_url"):
            results["website"] = scrape_website(profile["website_url"])

    def _ig():
        if profile.get("instagram_handle"):
            results["instagram"] = scrape_instagram(profile["instagram_handle"])

    threads = [threading.Thread(target=f) for f in (_yt, _web, _ig)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)

    return results
