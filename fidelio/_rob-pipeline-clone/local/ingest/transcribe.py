"""
Fidelio Pipeline — Whisper Transcription
Calls OpenAI Whisper API. Returns timecoded segments.
Caches results to avoid re-transcribing.
"""
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

from openai import OpenAI

log = logging.getLogger("fidelio.transcribe")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

FFMPEG = os.getenv("FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg")
WHISPER_MAX_MB = 24
WHISPER_SUPPORTED = {".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".wav", ".webm"}


def _to_whisper_audio(file_path: Path) -> tuple[Path, bool]:
    """Always extract audio to mp3 before sending to Whisper.
    Avoids ASCII filename issues and format rejection on re-encoded MP4s."""
    tmp = Path(tempfile.mktemp(suffix=".mp3"))
    log.info(f"Extracting audio → mp3 for Whisper: {file_path.name}")
    subprocess.run(
        [FFMPEG, "-y", "-i", str(file_path), "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", str(tmp)],
        capture_output=True, check=True
    )
    return tmp, True


def transcribe(file_path: Path, cache_dir: Path, pass_num: int = 1, language: str = None) -> dict:
    """
    Transcribe a video/audio file using OpenAI Whisper API.

    Returns:
        {
            "text": "Full transcript as plain text",
            "segments": [{"start": 0.0, "end": 3.2, "text": "Bonjour..."}, ...],
            "language": "fr",
            "duration_seconds": 502.4
        }
    """
    language = language.split("-")[0].lower() if language else None
    cache_key = f"{file_path.stem}_pass{pass_num}.json"
    cache_path = cache_dir / cache_key

    if cache_path.exists():
        log.info(f"Transcript cache hit: {cache_key}")
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    log.info(f"Transcribing (Pass {pass_num}): {file_path.name}")

    audio_path, is_temp = _to_whisper_audio(file_path)
    try:
        file_size_mb = audio_path.stat().st_size / 1024 / 1024
        if file_size_mb > WHISPER_MAX_MB:
            log.info(f"File is {file_size_mb:.0f} MB — chunking for Whisper")
            result = _transcribe_chunked(audio_path, language)
        else:
            result = _transcribe_direct(audio_path, language)
    finally:
        if is_temp and audio_path.exists():
            audio_path.unlink(missing_ok=True)

    # Cache result
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    log.info(f"Transcript cached: {cache_key} ({len(result['text'])} chars)")

    return result


def _transcribe_direct(file_path: Path, language: str = None) -> dict:
    """Single API call for files under 25 MB."""
    kwargs = {
        "model": "whisper-1",
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment"],
    }
    if language:
        kwargs["language"] = language

    with open(file_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            file=audio_file,
            **kwargs
        )

    return {
        "text": response.text,
        "segments": [
            {
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip()
            }
            for seg in (response.segments or [])
        ],
        "language": response.language,
        "duration_seconds": response.duration,
    }


def _transcribe_chunked(file_path: Path, language: str = None) -> dict:
    """
    Split large files using ffmpeg and transcribe in chunks.
    Reassembles segments with corrected timestamps.
    """
    import subprocess
    import tempfile

    ffmpeg = os.getenv("FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg")
    chunk_duration = 600  # 10-minute chunks

    # Get total duration
    probe_cmd = [
        "/opt/homebrew/bin/ffprobe", "-v", "quiet",
        "-print_format", "json", "-show_format", str(file_path)
    ]
    probe = subprocess.run(probe_cmd, capture_output=True, text=True)
    total_duration = float(json.loads(probe.stdout)["format"]["duration"])

    all_segments = []
    full_text_parts = []
    offset = 0.0

    with tempfile.TemporaryDirectory() as tmp_dir:
        chunk_num = 0
        while offset < total_duration:
            chunk_path = Path(tmp_dir) / f"chunk_{chunk_num:03d}.mp3"
            cmd = [
                ffmpeg, "-y", "-i", str(file_path),
                "-ss", str(offset),
                "-t", str(chunk_duration),
                "-vn", "-ar", "16000", "-ac", "1",
                str(chunk_path)
            ]
            subprocess.run(cmd, capture_output=True, check=True)

            kwargs = {"model": "whisper-1", "response_format": "verbose_json",
                      "timestamp_granularities": ["segment"]}
            if language:
                kwargs["language"] = language

            with open(chunk_path, "rb") as f:
                resp = client.audio.transcriptions.create(file=f, **kwargs)

            for seg in (resp.segments or []):
                all_segments.append({
                    "start": round(seg.start + offset, 2),
                    "end": round(seg.end + offset, 2),
                    "text": seg.text.strip()
                })
            full_text_parts.append(resp.text)

            offset += chunk_duration
            chunk_num += 1
            log.info(f"Chunk {chunk_num} done ({offset:.0f}s / {total_duration:.0f}s)")

    return {
        "text": " ".join(full_text_parts),
        "segments": all_segments,
        "language": language or "unknown",
        "duration_seconds": total_duration,
    }


def transcript_summary(result: dict, max_chars: int = 200) -> str:
    """Return first N chars of transcript for Sheets summary column."""
    text = result.get("text", "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0] + "…"


def marker_text(result: dict, max_chars: int = 100) -> str:
    """Return first N chars suitable for a Resolve timeline marker."""
    return transcript_summary(result, max_chars)
