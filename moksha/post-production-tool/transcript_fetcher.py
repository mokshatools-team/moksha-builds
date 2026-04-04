"""
transcript_fetcher.py — YouTube transcript + metadata fetching.

Priority:
  1. YouTube captions (free, instant) via youtube_transcript_api
  2. Whisper API fallback (OpenAI, $0.006/min) via yt-dlp audio download
"""

import os
import re
import shutil
import subprocess
import tempfile
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Resolve yt-dlp at import time — launchd has a minimal PATH so we fall back to the known install location
_YTDLP = shutil.which('yt-dlp') or '/Users/robertsinclair/Library/Python/3.9/bin/yt-dlp'

_YT_API = None

def _get_api():
    global _YT_API
    if _YT_API is None:
        from youtube_transcript_api import YouTubeTranscriptApi
        _YT_API = YouTubeTranscriptApi()
    return _YT_API


def extract_video_id(url: str) -> Optional[str]:
    url = url.strip()
    m = re.match(r'(?:https?://)?youtu\.be/([a-zA-Z0-9_-]{11})', url)
    if m: return m.group(1)
    m = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', url)
    if m: return m.group(1)
    m = re.match(r'(?:https?://)?(?:www\.)?youtube\.com/shorts/([a-zA-Z0-9_-]{11})', url)
    if m: return m.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url): return url
    return None


def get_video_metadata(video_id: str) -> dict:
    try:
        result = subprocess.run(
            [_YTDLP, '--print', '%(title)s\t%(channel)s\t%(upload_date)s\t%(duration_string)s',
             '--no-playlist', '--no-warnings', '--quiet',
             f'https://www.youtube.com/watch?v={video_id}'],
            capture_output=True, text=True, timeout=30
        )
        parts = result.stdout.strip().split('\t')
        return {
            'title':       parts[0] if len(parts) > 0 else video_id,
            'channel':     parts[1] if len(parts) > 1 else '',
            'upload_date': parts[2] if len(parts) > 2 else '',
            'duration':    parts[3] if len(parts) > 3 else '',
            'video_id':    video_id,
            'url':         f'https://www.youtube.com/watch?v={video_id}',
        }
    except Exception as e:
        logger.warning(f"Metadata fetch failed for {video_id}: {e}")
        return {'title': video_id, 'channel': '', 'upload_date': '', 'duration': '',
                'video_id': video_id, 'url': f'https://www.youtube.com/watch?v={video_id}'}


def _get_captions(video_id: str) -> str:
    """Try YouTube's existing captions in whatever language they exist. No translation. Returns '' if none."""
    try:
        api = _get_api()
        # Try to grab any available transcript — prefer manually created, then auto-generated
        transcript_list = api.list(video_id)
        # Manual transcripts first, then generated
        ordered = sorted(transcript_list, key=lambda t: (t.is_generated, t.language_code))
        for t in ordered:
            try:
                fetched = t.fetch()
                text = ' '.join(s.text for s in fetched)
                if text:
                    logger.info(f"Got captions: {t.language_code} (auto={t.is_generated})")
                    return text
            except Exception:
                continue
        return ''
    except Exception:
        return ''


def _whisper_transcribe(video_id: str) -> str:
    """Download audio + transcribe with OpenAI Whisper API. Returns '' on failure."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("OPENAI_API_KEY not set — Whisper fallback unavailable")
        return ''

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, f"{video_id}.mp3")

        # Download audio only
        logger.info(f"Downloading audio for Whisper: {video_id}")
        dl = subprocess.run(
            [_YTDLP, '-x', '--audio-format', 'mp3', '--audio-quality', '5',
             '--cookies-from-browser', 'safari',
             '--no-warnings', '--quiet', '-o', audio_path,
             f'https://www.youtube.com/watch?v={video_id}'],
            capture_output=True, text=True, timeout=120
        )
        if dl.returncode != 0 or not os.path.exists(audio_path):
            logger.warning(f"Audio download failed for {video_id}: {dl.stderr[:200]}")
            return ''

        # Transcribe with Whisper
        try:
            import openai
            client = openai.OpenAI(api_key=api_key)
            with open(audio_path, 'rb') as f:
                result = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    response_format="text",
                )
            logger.info(f"Whisper transcription complete for {video_id}")
            return result if isinstance(result, str) else result.text
        except Exception as e:
            logger.warning(f"Whisper API failed for {video_id}: {e}")
            return ''


def get_transcript(video_id: str, progress_cb=None) -> tuple:
    """
    Returns (transcript_text, source) where source is 'captions' or 'whisper'.
    progress_cb(msg) called with status updates.
    """
    if progress_cb:
        progress_cb("Fetching transcript…")

    text = _get_captions(video_id)
    if text:
        logger.info(f"Captions found for {video_id}")
        return text, 'captions'

    # Fallback to Whisper
    logger.info(f"No captions for {video_id} — falling back to Whisper")
    if progress_cb:
        progress_cb("No captions found — transcribing with Whisper…")

    text = _whisper_transcribe(video_id)
    if text:
        return text, 'whisper'

    return '', 'none'


def get_recent_uploads(channel_url: str, limit: int = 20) -> list:
    if not channel_url:
        return []
    try:
        result = subprocess.run(
            [_YTDLP, '--flat-playlist',
             '--print', '%(id)s\t%(title)s\t%(upload_date>%Y-%m-%d,)s',
             '--no-warnings', '--quiet', f'--playlist-end={limit}', channel_url],
            capture_output=True, text=True, timeout=60
        )
        videos = []
        for line in result.stdout.strip().splitlines():
            parts = line.split('\t')
            if len(parts) >= 2 and parts[0]:
                videos.append({
                    'id':          parts[0],
                    'title':       parts[1] if len(parts) > 1 else parts[0],
                    'upload_date': parts[2] if len(parts) > 2 else '',
                    'url':         f'https://www.youtube.com/watch?v={parts[0]}',
                })
        return videos
    except Exception as e:
        logger.warning(f"Recent uploads fetch failed: {e}")
        return []


def fetch_for_production(url: str, progress_cb=None) -> dict:
    video_id = extract_video_id(url)
    if not video_id:
        return {'error': 'Invalid YouTube URL — paste a full youtube.com or youtu.be link.'}

    meta = get_video_metadata(video_id)
    transcript, source = get_transcript(video_id, progress_cb=progress_cb)

    if not transcript:
        return {'error': 'Could not get transcript — no captions and Whisper fallback failed. Check your OPENAI_API_KEY.'}

    MAX_CHARS = 25_000
    if len(transcript) > MAX_CHARS:
        transcript = transcript[:MAX_CHARS] + '\n[transcript truncated]'

    return {**meta, 'transcript': transcript, 'transcript_length': len(transcript), 'transcript_source': source}
