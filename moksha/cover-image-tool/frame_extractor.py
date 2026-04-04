#!/usr/bin/env python3
"""
frame_extractor.py — YouTube / local video frame extraction for Cover Image Tool
"""

import base64
import os
import re
import subprocess
import tempfile
import urllib.request

FFMPEG  = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
YTDLP   = "/opt/homebrew/bin/yt-dlp"


def _video_id(url: str):
    """Extract YouTube video ID from any YouTube URL (including unlisted)."""
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def get_youtube_thumbnail(url: str) -> bytes:
    """
    Fetch the highest-resolution YouTube auto-thumbnail.
    Works for unlisted videos — no auth needed.
    Returns JPEG bytes.
    """
    vid = _video_id(url)
    if not vid:
        raise ValueError(f"Could not extract video ID from: {url}")
    for quality in ("maxresdefault", "sddefault", "hqdefault"):
        thumb_url = f"https://img.youtube.com/vi/{vid}/{quality}.jpg"
        try:
            with urllib.request.urlopen(thumb_url, timeout=10) as r:
                data = r.read()
            # YouTube returns a tiny 120x90 placeholder for missing qualities
            if len(data) > 5000:
                return data
        except Exception:
            continue
    raise RuntimeError(f"Could not fetch thumbnail for video ID: {vid}")


def _get_duration(source: str) -> float:
    """Get video duration in seconds via ffprobe. source = file path or URL."""
    cmd = [
        FFPROBE, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        source,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    try:
        return float(result.stdout.strip())
    except ValueError:
        raise RuntimeError(f"ffprobe failed: {result.stderr[:200]}")


def _extract_frame_at(source: str, timestamp: float) -> bytes:
    """Extract a single JPEG frame at the given timestamp. Returns JPEG bytes."""
    cmd = [
        FFMPEG, "-ss", str(timestamp),
        "-i", source,
        "-frames:v", "1",
        "-q:v", "4",
        "-f", "image2",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=60)
    if not result.stdout:
        raise RuntimeError(f"ffmpeg returned no frame at {timestamp}s")
    return result.stdout


def extract_frames_from_source(source: str, count: int = 12) -> list[dict]:
    """
    Extract `count` evenly-spaced frames from a video source.
    source: local file path or yt-dlp-downloadable URL
    Returns: [{"timestamp": "0:23", "frame_b64": "<base64 jpeg>"}, ...]
    """
    if source.startswith("http"):
        # Download to a temp file — signed stream URLs expire and ffprobe can't
        # access them directly. Temp file is deleted after extraction.
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = _download_yt_to_file(source, tmpdir)
            return _extract_frames_local(local_path, count)
    else:
        return _extract_frames_local(source, count)


def _extract_frames_local(video_path: str, count: int) -> list[dict]:
    """Extract frames from a local file path."""
    duration = _get_duration(video_path)
    # Skip first 3% and last 3% to avoid intros/outros
    start = duration * 0.03
    end   = duration * 0.97
    span  = end - start
    steps = [start + (span * i / (count - 1)) for i in range(count)]

    frames = []
    for ts in steps:
        try:
            jpeg_bytes = _extract_frame_at(video_path, ts)
            b64 = base64.b64encode(jpeg_bytes).decode()
            mins = int(ts // 60)
            secs = int(ts % 60)
            frames.append({"timestamp": f"{mins}:{secs:02d}", "frame_b64": b64})
        except Exception as e:
            frames.append({"timestamp": f"{int(ts)}s", "frame_b64": "", "error": str(e)})

    return frames


def _download_yt_to_file(url: str, tmpdir: str) -> str:
    """
    Download a YouTube video to tmpdir using yt-dlp (lowest quality for speed).
    Returns the path to the downloaded file.
    """
    cmd = [
        YTDLP,
        "--no-playlist",
        "--no-warnings",                         # suppress LibreSSL/urllib3 warnings
        "-f", "worstvideo/worst",                # smallest available — fastest download
        "-o", os.path.join(tmpdir, "video.%(ext)s"),
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    # Find whatever yt-dlp saved (extension unknown until download)
    files = [f for f in os.listdir(tmpdir) if not f.endswith(".part") and not f.endswith(".ytdl")]
    if result.returncode != 0 or not files:
        # Strip warnings from stderr to show only real errors
        real_errors = "\n".join(
            l for l in result.stderr.splitlines()
            if "WARNING" not in l and "NotOpenSSLWarning" not in l and l.strip()
        )
        raise RuntimeError(f"yt-dlp download failed: {real_errors[:300] or result.stderr[:300]}")
    return os.path.join(tmpdir, files[0])
