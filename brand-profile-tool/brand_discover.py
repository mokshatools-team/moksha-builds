#!/usr/bin/env python3
"""
brand_discover.py — Auto-discover social channels and web presence for a new brand.

Given a name ("RSV") or URL ("https://rsv.ca" or "youtube.com/@handle"), find:
  - Official website
  - YouTube channel URL
  - Instagram handle
  - TikTok handle (bonus)

Discovery strategy:
  - YouTube URL  → extract channel links (About section) → scrape linked website
  - Website URL  → scrape for socials → if YouTube found, get its channel links too
  - Brand name   → DuckDuckGo → scrape → YouTube search → cross-reference
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import warnings
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

YTDLP   = "/opt/homebrew/bin/yt-dlp"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _get(url: str, timeout: int = 10) -> Optional[requests.Response]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            r = requests.get(url, headers=HEADERS, timeout=timeout, verify=False, allow_redirects=True)
        return r if r.status_code == 200 else None
    except Exception:
        return None


def _is_youtube_url(url: str) -> bool:
    return bool(re.match(r'https?://(?:www\.)?(?:youtube\.com|youtu\.be)/', url, re.I))


def _clean_youtube_url(url: str) -> Optional[str]:
    """Normalize to a clean channel URL, or None if it's a video/playlist."""
    url = url.split("?")[0].rstrip("/")
    if any(x in url for x in ["/watch", "/playlist", "/shorts", "/live", "/results", "/feed"]):
        return None
    m = re.match(r'(https?://(?:www\.)?youtube\.com/(?:@[\w\-\.]+|channel/[\w\-]+|c/[\w\-]+))', url)
    return m.group(1) if m else None


def _extract_socials_from_html(html: str) -> dict:
    """Scan HTML/text for social media profile links."""
    found = {}

    patterns = {
        "youtube_url":      r'https?://(?:www\.)?youtube\.com/(?:@[\w\-\.]+|channel/[\w\-]+|c/[\w\-]+)',
        "instagram_handle": r'https?://(?:www\.)?instagram\.com/([\w\.\-]+)/?',
        "tiktok_handle":    r'https?://(?:www\.)?tiktok\.com/@([\w\.\-]+)/?',
        "facebook_url":     r'https?://(?:www\.)?facebook\.com/([\w\.\-]+)/?',
        "twitter_handle":   r'https?://(?:www\.)?(?:twitter|x)\.com/([\w\-]+)/?',
    }

    INSTAGRAM_SKIP = {"p", "explore", "reel", "reels", "stories", "accounts", "intent",
                      "share", "tv", "direct", "a", "ar"}
    TIKTOK_SKIP    = {"explore", "upload", "login", "signup", "for-you", "following",
                      "live", "effects", "music", "tag"}
    FACEBOOK_SKIP  = {"sharer", "share", "dialog", "people", "groups", "pg", "pages",
                      "login", "help", "privacy", "terms", "about", "home"}
    TWITTER_SKIP   = {"share", "intent", "i", "home", "explore", "notifications",
                      "messages", "settings", "hashtag"}

    for key, pat in patterns.items():
        m = re.search(pat, html)
        if not m:
            continue

        if key == "youtube_url":
            clean = _clean_youtube_url(m.group(0))
            if clean:
                found[key] = clean

        elif key == "instagram_handle":
            handle = m.group(1).strip("/.").strip()
            if handle.lower() not in INSTAGRAM_SKIP and handle:
                found[key] = "@" + handle

        elif key == "tiktok_handle":
            handle = m.group(1).strip("/.").strip()
            if handle.lower() not in TIKTOK_SKIP and handle:
                found[key] = "@" + handle

        elif key == "facebook_url":
            slug = m.group(1).strip("/.").strip()
            if slug.lower() not in FACEBOOK_SKIP and slug:
                found[key] = m.group(0).split("?")[0].rstrip("/")

        elif key == "twitter_handle":
            handle = m.group(1).strip()
            if handle.lower() not in TWITTER_SKIP and handle:
                found[key] = "@" + handle

    return found


def _scrape_website_for_socials(url: str) -> dict:
    """Fetch a website and extract social media links + meta info."""
    r = _get(url, timeout=12)
    if not r:
        return {"website_url": url}

    html = r.text
    result = _extract_socials_from_html(html)
    result["website_url"] = str(r.url).rstrip("/")

    soup = BeautifulSoup(html, "html.parser")
    if soup.title:
        result["_page_title"] = (soup.title.string or "").strip()
    meta_desc = soup.select_one('meta[name="description"]') or soup.select_one('meta[property="og:description"]')
    if meta_desc and meta_desc.get("content"):
        result["_meta_description"] = meta_desc["content"].strip()[:300]

    return result


def _get_youtube_channel_links(channel_url: str) -> dict:
    """
    Extract the channel's linked website and social profiles from its About section.
    Tries yt-dlp first (fastest), then falls back to scraping the About page HTML.
    """
    import re as _re
    from urllib.parse import urlparse as _up, parse_qs as _pqs, unquote as _uq

    SOCIAL_DOMAINS = ("instagram.com", "tiktok.com", "twitter.com", "x.com",
                      "facebook.com", "youtube.com", "linkedin.com", "pinterest.com")

    def _resolve_url(url: str) -> str:
        """Follow redirects, decode YouTube's link redirect format."""
        if not url:
            return url
        # YouTube embeds links as https://www.youtube.com/redirect?q=<actual_url>
        m = _re.search(r'[?&]q=([^&]+)', url)
        if m:
            return _uq(m.group(1))
        if "google.com/url" in url or "redirect" in url.lower():
            try:
                resolved = requests.head(url, headers=HEADERS, allow_redirects=True, timeout=8).url
                return resolved
            except Exception:
                pass
        return url

    links = {}

    # ── Try yt-dlp first ──────────────────────────────────────────────────────
    try:
        cmd = [YTDLP, "--dump-single-json", "--no-warnings", "--playlist-items", "0", channel_url]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        if r.returncode == 0 and r.stdout.strip():
            data = json.loads(r.stdout.strip())

            for link_obj in (data.get("links") or []):
                url = _resolve_url(link_obj.get("url", ""))
                if not url:
                    continue
                socials = _extract_socials_from_html(f'<a href="{url}">')
                is_social = any(d in url for d in SOCIAL_DOMAINS)
                if not is_social and "website_url" not in links:
                    links["website_url"] = url.split("?")[0].rstrip("/")
                links.update({k: v for k, v in socials.items() if k not in links})

            desc = data.get("description") or ""
            if desc:
                links.update({k: v for k, v in _extract_socials_from_html(desc).items() if k not in links})
    except Exception as e:
        logger.debug(f"yt-dlp channel links failed: {e}")

    if links:
        logger.info(f"YouTube channel links (yt-dlp) for {channel_url}: {links}")
        return links

    # ── Fallback: scrape About page HTML ─────────────────────────────────────
    try:
        about_url = channel_url.rstrip("/") + "/about"
        r2 = _get(about_url, timeout=15)
        if r2:
            # YouTube embeds its data as JS — look for redirect links in the JSON blob
            redirect_urls = _re.findall(
                r'https://www\.youtube\.com/redirect\?[^"\'\\]+', r2.text
            )
            for redir in redirect_urls:
                actual = _resolve_url(redir.replace("\\u0026", "&"))
                if not actual or "youtube.com" in actual:
                    continue
                socials = _extract_socials_from_html(f'<a href="{actual}">')
                is_social = any(d in actual for d in SOCIAL_DOMAINS)
                if not is_social and "website_url" not in links:
                    links["website_url"] = actual.split("?")[0].rstrip("/")
                links.update({k: v for k, v in socials.items() if k not in links})

            # Also look for direct instagram/tiktok URLs in the blob
            direct_socials = _extract_socials_from_html(r2.text)
            links.update({k: v for k, v in direct_socials.items() if k not in links})
            # Remove any youtube_url pointing back to the same channel
            if links.get("youtube_url") and channel_url.split("@")[-1].lower() in links["youtube_url"].lower():
                pass  # keep it — same channel
    except Exception as e:
        logger.debug(f"YouTube About page scrape failed: {e}")

    logger.info(f"YouTube channel links for {channel_url}: {links}")
    return links


def _search_youtube(query: str) -> Optional[str]:
    """Search YouTube for a channel matching the query. Returns channel URL or None."""
    try:
        cmd = [
            YTDLP, "--no-warnings", "--flat-playlist",
            "--dump-json", "--playlist-items", "1:5",
            f"ytsearch5:{query}",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        for line in r.stdout.strip().splitlines():
            try:
                v = json.loads(line)
                ch_url = v.get("channel_url") or v.get("uploader_url") or ""
                if ch_url and "youtube.com" in ch_url:
                    return ch_url.rstrip("/")
            except Exception:
                continue
    except Exception as e:
        logger.debug(f"YouTube search failed: {e}")
    return None


def _search_web_for_website(name: str) -> Optional[str]:
    """Try DuckDuckGo to find the brand's official website."""
    from urllib.parse import urlparse, parse_qs, unquote

    SOCIAL_DOMAINS = ("youtube.com", "instagram.com", "tiktok.com", "twitter.com",
                      "x.com", "facebook.com", "linkedin.com", "wikipedia.org",
                      "duckduckgo.com", "google.com")

    def _is_social(url: str) -> bool:
        try:
            host = urlparse(url).netloc.lower().lstrip("www.")
            return any(host == s or host.endswith("." + s) for s in SOCIAL_DOMAINS)
        except Exception:
            return True

    def _decode_ddg_redirect(href: str) -> Optional[str]:
        """Decode //duckduckgo.com/l/?uddg=... redirect URLs."""
        if not href:
            return None
        if href.startswith("//"):
            href = "https:" + href
        parsed = urlparse(href)
        if "duckduckgo.com" in parsed.netloc:
            uddg = parse_qs(parsed.query).get("uddg", [None])[0]
            if uddg:
                return unquote(uddg)
            return None
        return href

    # Try instant answer API first
    try:
        r = _get(
            f"https://api.duckduckgo.com/?q={requests.utils.quote(name)}&format=json&no_redirect=1",
            timeout=8,
        )
        if r:
            data = r.json()
            url = data.get("AbstractURL") or data.get("Redirect") or ""
            if url and not _is_social(url):
                logger.info(f"DuckDuckGo instant answer: {url}")
                return url
    except Exception:
        pass

    # Fallback: DuckDuckGo HTML search
    try:
        r = _get(
            f"https://html.duckduckgo.com/html/?q={requests.utils.quote(name + ' official site')}",
            timeout=12,
        )
        if r:
            soup = BeautifulSoup(r.text, "html.parser")
            # DDG HTML uses result__a for the main link and result__url for the display URL
            for a in soup.select("a.result__a"):
                href = _decode_ddg_redirect(a.get("href", ""))
                if href and not _is_social(href):
                    logger.info(f"DuckDuckGo HTML result: {href}")
                    return href.split("?")[0].rstrip("/")
    except Exception as e:
        logger.debug(f"DuckDuckGo HTML search failed: {e}")

    return None


def _merge(base: dict, extra: dict) -> dict:
    """Merge extra into base, only filling in missing keys."""
    for k, v in extra.items():
        if k not in base or not base[k]:
            base[k] = v
    return base


# ── Main Entry Point ─────────────────────────────────────────────────────────

def discover(query: str) -> dict:
    """
    Auto-discover brand social channels from a name or URL.

    Returns a dict with any of:
      website_url, youtube_url, instagram_handle, tiktok_handle,
      twitter_handle, facebook_url
    """
    query = query.strip()
    result: dict = {}

    # Normalize: add scheme if missing for URL-like inputs
    if not query.startswith("http") and ("." in query.split("/")[0] or query.startswith("@")):
        if query.startswith("@"):
            # Social handle — treat as a name search
            pass
        else:
            query = "https://" + query

    is_yt  = query.startswith("http") and _is_youtube_url(query)
    is_url = query.startswith("http") and not is_yt

    # ── Path 1: YouTube URL given ─────────────────────────────────────────────
    if is_yt:
        clean = _clean_youtube_url(query)
        if clean:
            result["youtube_url"] = clean
        logger.info(f"Discovering from YouTube URL: {query}")

        # Pull linked website + socials from About section
        yt_links = _get_youtube_channel_links(query)
        _merge(result, yt_links)

        # If we got a linked website, scrape it for more socials
        if result.get("website_url") and "youtube.com" not in result["website_url"]:
            web = _scrape_website_for_socials(result["website_url"])
            _merge(result, web)

    # ── Path 2: Website URL given ─────────────────────────────────────────────
    elif is_url:
        logger.info(f"Discovering from website URL: {query}")
        result = _scrape_website_for_socials(query)

        # Find YouTube if not on site
        if not result.get("youtube_url"):
            search_term = result.get("_page_title") or query
            logger.info(f"No YouTube on site, searching: {search_term}")
            yt = _search_youtube(search_term)
            if yt:
                result["youtube_url"] = yt

        # With YouTube URL in hand, pull channel links to fill gaps
        if result.get("youtube_url"):
            yt_links = _get_youtube_channel_links(result["youtube_url"])
            _merge(result, yt_links)
            # If YT links gave us a website and we didn't have one, scrape it
            if result.get("website_url") and result["website_url"] != query.rstrip("/"):
                web2 = _scrape_website_for_socials(result["website_url"])
                _merge(result, web2)

    # ── Path 3: Brand name ────────────────────────────────────────────────────
    else:
        logger.info(f"Discovering from name: {query}")

        # Try to find website
        website = _search_web_for_website(query)
        if website:
            logger.info(f"Found website: {website}")
            result = _scrape_website_for_socials(website)

        # Search YouTube
        if not result.get("youtube_url"):
            yt = _search_youtube(query)
            if yt:
                result["youtube_url"] = yt

        # Pull YouTube channel links
        if result.get("youtube_url"):
            yt_links = _get_youtube_channel_links(result["youtube_url"])
            _merge(result, yt_links)

        # If YouTube gave us a website and we didn't have one, scrape it
        if result.get("website_url") and not website:
            web = _scrape_website_for_socials(result["website_url"])
            _merge(result, web)
        elif result.get("website_url") and result["website_url"] != (website or "").rstrip("/"):
            web = _scrape_website_for_socials(result["website_url"])
            _merge(result, web)

    # Don't let website_url point to YouTube
    if result.get("website_url") and "youtube.com" in result.get("website_url", ""):
        del result["website_url"]

    # Clean up internal keys
    clean = {k: v for k, v in result.items() if not k.startswith("_")}
    logger.info(f"Final discovery result for '{query}': {clean}")
    return clean
