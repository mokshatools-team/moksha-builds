"""
Whisper transcription for FDL1 Publishing Pipeline.
In mock mode: returns a hardcoded French medical transcript.
"""

import os
import logging

logger = logging.getLogger("fdl1.whisper")

MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"
MAX_RETRIES = 3

MOCK_TRANSCRIPT = (
    "Aujourd'hui, on va parler de la fascia thoraco-lombaire. "
    "C'est une structure qui est souvent sous-estimee en osteopathie, "
    "mais qui joue un role fondamental dans la stabilisation du tronc. "
    "Quand on regarde les insertions musculaires, on voit que le grand dorsal, "
    "le transverse de l'abdomen et le grand fessier s'y attachent tous. "
    "Ce qui veut dire que toute restriction dans cette zone peut avoir "
    "des repercussions sur la mobilite de la hanche, de l'epaule, "
    "et meme sur la respiration. En clinique, je vois ca tous les jours."
)


def transcribe(file_path: str, language: str = "fr") -> str:
    """
    Transcribe audio/video file using OpenAI Whisper API.
    Returns transcript text.

    In mock mode: returns a hardcoded French transcript.
    """
    if MOCK_MODE:
        return _mock_transcribe(file_path, language)

    return _real_transcribe(file_path, language)


def _mock_transcribe(file_path: str, language: str) -> str:
    """Mock transcription — returns a sample French medical transcript."""
    logger.info(f"[MOCK] Transcribing: {file_path} (language: {language})")
    logger.info(f"[MOCK] Transcript length: {len(MOCK_TRANSCRIPT)} chars")
    return MOCK_TRANSCRIPT


def _real_transcribe(file_path: str, language: str) -> str:
    """
    Real Whisper transcription via OpenAI API.
    Requires OPENAI_API_KEY in environment.
    """
    # This will be implemented when real credentials are available.
    # Steps:
    # 1. Read OPENAI_API_KEY from env
    # 2. Open audio file
    # 3. Call openai.audio.transcriptions.create with model="whisper-1"
    # 4. Return transcript text

    raise NotImplementedError(
        "Real Whisper transcription not yet implemented. Set FDL1_MOCK_MODE=true."
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    transcript = transcribe("/tmp/test.mp4")
    print(f"Transcript:\n{transcript}")
