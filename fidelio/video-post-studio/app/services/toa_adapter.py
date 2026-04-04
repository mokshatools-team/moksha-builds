"""Lightweight TOA adapter seam for shared workspace state."""

from dataclasses import dataclass
from typing import Optional

from app.models.contracts import Workspace

TOA_TRANSCRIPT_PREVIEW_LIMIT = 80


@dataclass(frozen=True)
class TOAWorkspaceSummary:
    """Minimal workspace state exposed to the TOA shell page."""

    has_transcript: bool
    transcript_length: int
    transcript_preview: Optional[str]
    status_message: str


def _build_transcript_preview(transcript_text: str) -> Optional[str]:
    """Return a bounded transcript preview for the TOA summary."""

    if not transcript_text:
        return None

    if len(transcript_text) <= TOA_TRANSCRIPT_PREVIEW_LIMIT:
        return transcript_text

    return f"{transcript_text[: TOA_TRANSCRIPT_PREVIEW_LIMIT - 3]}..."


def build_toa_workspace_summary(workspace: Workspace) -> TOAWorkspaceSummary:
    """Summarize workspace state without pulling in real TOA behavior."""

    transcript_session = workspace.active_transcript_session
    transcript_text = (
        transcript_session.transcript_text if transcript_session is not None else ""
    )

    if transcript_session is None:
        status_message = "No shared transcript is ready for TOA yet."
    else:
        status_message = "TOA can now operate from the shared transcript layer."

    return TOAWorkspaceSummary(
        has_transcript=transcript_session is not None,
        transcript_length=len(transcript_text),
        transcript_preview=_build_transcript_preview(transcript_text),
        status_message=status_message,
    )
