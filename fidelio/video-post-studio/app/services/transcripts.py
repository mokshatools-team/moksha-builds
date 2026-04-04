"""Transcript service helpers."""


def build_mock_transcript(source_type: str, title: str, source_value: str) -> str:
    """Return deterministic transcript text for a single imported source."""

    return f"Mock transcript for {title} from {source_type}: {source_value}"
