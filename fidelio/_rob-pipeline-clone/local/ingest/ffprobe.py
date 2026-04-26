from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path


FFPROBE_BIN = "/opt/homebrew/bin/ffprobe"


def _parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_fps(stream):
    if not stream:
        return None

    for field in ("avg_frame_rate", "r_frame_rate"):
        rate = stream.get(field)
        if not rate or rate in {"0/0", "N/A"}:
            continue

        try:
            if "/" in rate:
                numerator, denominator = rate.split("/", 1)
                denominator_value = float(denominator)
                if denominator_value == 0:
                    continue
                return round(float(numerator) / denominator_value, 3)
            return round(float(rate), 3)
        except (TypeError, ValueError, ZeroDivisionError):
            continue

    return None


def _format_duration(duration_seconds):
    if duration_seconds is None:
        return None

    total_seconds = max(int(round(duration_seconds)), 0)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    parts = []
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    if seconds or not parts:
        parts.append(f"{seconds}s")
    return " ".join(parts)


def _format_shoot_date(timestamp):
    if timestamp is None:
        return None

    dt = datetime.fromtimestamp(timestamp)
    return f"{dt:%b} {dt.day}, {dt:%Y}"


def _format_size_mb(size_bytes):
    if size_bytes is None:
        return None
    return round(size_bytes / (1024 * 1024), 2)


def extract_metadata(file_path) -> dict:
    path = Path(file_path)

    try:
        stat_result = path.stat()
    except OSError:
        stat_result = None

    metadata = {
        "filename": path.name,
        "duration_seconds": None,
        "duration_formatted": None,
        "fps": None,
        "width": None,
        "height": None,
        "resolution": None,
        "codec_video": None,
        "codec_audio": None,
        "file_size_mb": _format_size_mb(stat_result.st_size) if stat_result else None,
        "shoot_date": _format_shoot_date(stat_result.st_mtime) if stat_result else None,
    }

    try:
        result = subprocess.run(
            [
                FFPROBE_BIN,
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-show_format",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        probe_data = json.loads(result.stdout or "{}")
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return metadata

    streams = probe_data.get("streams") or []
    format_data = probe_data.get("format") or {}
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)

    duration_seconds = _parse_float(format_data.get("duration"))
    if duration_seconds is None and video_stream:
        duration_seconds = _parse_float(video_stream.get("duration"))

    width = video_stream.get("width") if video_stream else None
    height = video_stream.get("height") if video_stream else None

    size_bytes = _parse_float(format_data.get("size"))
    if size_bytes is not None:
        metadata["file_size_mb"] = _format_size_mb(size_bytes)

    metadata.update(
        {
            "duration_seconds": duration_seconds,
            "duration_formatted": _format_duration(duration_seconds),
            "fps": _parse_fps(video_stream),
            "width": width,
            "height": height,
            "resolution": f"{width}×{height}" if width and height else None,
            "codec_video": video_stream.get("codec_name") if video_stream else None,
            "codec_audio": audio_stream.get("codec_name") if audio_stream else None,
        }
    )

    return metadata


def get_content_type(metadata: dict) -> str:
    height = metadata.get("height")
    width = metadata.get("width")

    if height and width and height > width:
        return "short_form"
    return "long_form"
