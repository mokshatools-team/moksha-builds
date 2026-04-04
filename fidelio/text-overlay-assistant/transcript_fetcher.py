import os
import re
import subprocess
import sys
import tempfile
from typing import List, Optional
from urllib.parse import parse_qs, urlparse


TEMP_DIR = tempfile.gettempdir()
SUPPORTED_VIDEO_EXTS = {".mp4", ".mov", ".mxf", ".avi"}


def is_youtube_url(source: str) -> bool:
    if not source:
        return False

    try:
        parsed = urlparse(source.strip())
    except ValueError:
        return False

    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host == "youtu.be":
        return bool(parsed.path.strip("/"))
    if host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            return bool(parse_qs(parsed.query).get("v"))
        return parsed.path.startswith(("/shorts/", "/embed/"))
    return False


def seconds_to_timestamp(seconds: float) -> str:
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes}:{secs:02d}"


def _create_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    try:
        import openai
    except ImportError as exc:
        raise RuntimeError("The OpenAI SDK is not installed.") from exc

    return openai.OpenAI(api_key=api_key)


def _ensure_local_file(source: str) -> str:
    if not source:
        raise ValueError("Transcript source is required.")
    if not os.path.isfile(source):
        raise FileNotFoundError(f"Local file not found: {source}")
    return source


def extract_audio_with_ffmpeg(media_path: str) -> Optional[str]:
    suffix = ".mp3"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False, dir=TEMP_DIR)
    tmp.close()
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                media_path,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                "64k",
                tmp.name,
            ],
            check=True,
            timeout=300,
            capture_output=True,
            text=True,
        )
        return tmp.name
    except FileNotFoundError:
        os.unlink(tmp.name)
        return None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        os.unlink(tmp.name)
        return None


def download_youtube_audio(url: str) -> str:
    if not is_youtube_url(url):
        raise ValueError(f"Invalid YouTube URL: {url}")

    download_dir = tempfile.mkdtemp(prefix="toa-ytdlp-", dir=TEMP_DIR)
    output_template = os.path.join(download_dir, "source.%(ext)s")

    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "yt_dlp",
                "--no-playlist",
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--output",
                output_template,
                url,
            ],
            check=True,
            timeout=600,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("yt-dlp is not installed or not available in PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError(f"YouTube download timed out for URL: {url}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        raise ValueError(f"Could not download YouTube audio: {detail or url}") from exc

    for name in os.listdir(download_dir):
        candidate = os.path.join(download_dir, name)
        if os.path.isfile(candidate):
            return candidate

    raise ValueError(f"Could not download YouTube audio: no media file was created for {url}")


def transcribe_plain_text(media_path: str) -> str:
    client = _create_openai_client()

    try:
        with open(media_path, "rb") as media_file:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=media_file,
                response_format="text",
            )
    except Exception as exc:
        raise RuntimeError(f"Whisper transcription failed: {exc}") from exc

    text = str(result).strip()
    if not text:
        raise RuntimeError("Whisper transcription failed: empty transcript returned.")
    return text


def _normalize_segment_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def transcribe_media_segments(media_path: str, offset_seconds: float = 0.0) -> List[dict]:
    candidate_path = media_path
    extracted_audio = None
    ext = os.path.splitext(media_path)[1].lower()

    if ext in SUPPORTED_VIDEO_EXTS:
        extracted_audio = extract_audio_with_ffmpeg(media_path)
        if extracted_audio is not None:
            candidate_path = extracted_audio

    client = _create_openai_client()

    try:
        with open(candidate_path, "rb") as media_file:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=media_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )
    except Exception as exc:
        raise RuntimeError(f"Whisper transcription failed: {exc}") from exc
    finally:
        if extracted_audio and os.path.exists(extracted_audio):
            os.unlink(extracted_audio)

    segments = getattr(result, "segments", None) or []
    entries = []
    for segment in segments:
        start = float(segment.get("start", 0) if isinstance(segment, dict) else segment.start) + offset_seconds
        text = _normalize_segment_text(segment.get("text", "") if isinstance(segment, dict) else segment.text)
        if text:
            entries.append({"time": seconds_to_timestamp(start), "text": text})

    if not entries:
        raise RuntimeError("Whisper transcription failed: empty segment transcript returned.")

    return entries


def _cleanup_temp_media(path: str) -> None:
    if not path:
        return
    if os.path.exists(path):
        os.unlink(path)
    parent = os.path.dirname(path)
    if parent.startswith(TEMP_DIR):
        try:
            os.rmdir(parent)
        except OSError:
            pass


def fetch_transcript(source: str) -> str:
    if is_youtube_url(source):
        media_path = download_youtube_audio(source)
        try:
            return transcribe_plain_text(media_path)
        finally:
            _cleanup_temp_media(media_path)

    local_path = _ensure_local_file(source)
    return transcribe_plain_text(local_path)


def fetch_transcript_entries(source: str, offset_seconds: float = 0.0) -> List[dict]:
    if is_youtube_url(source):
        media_path = download_youtube_audio(source)
        try:
            return transcribe_media_segments(media_path, offset_seconds=offset_seconds)
        finally:
            _cleanup_temp_media(media_path)

    local_path = _ensure_local_file(source)
    return transcribe_media_segments(local_path, offset_seconds=offset_seconds)
