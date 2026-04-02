"""Workspace bootstrap helpers."""

from app.models.contracts import IMPORT_MODULE, SourceAsset, TranscriptSession, Workspace
from app.services.transcripts import build_mock_transcript


def build_demo_workspace(active_module: str = IMPORT_MODULE) -> Workspace:
    """Create the canonical demo workspace used by the shell."""

    return Workspace(id="ws_demo", name="Demo Workspace", active_module=active_module)


def _next_source_asset_id(workspace: Workspace) -> str:
    """Return the next available sequential source id for the workspace."""

    highest_numeric_id = 0
    for source_asset in workspace.source_assets:
        if source_asset.id.startswith("src_"):
            suffix = source_asset.id[4:]
            if suffix.isdigit():
                highest_numeric_id = max(highest_numeric_id, int(suffix))

    return f"src_{highest_numeric_id + 1:03d}"


def add_source_asset(
    workspace: Workspace,
    source_type: str,
    title: str,
    source_value: str,
) -> Workspace:
    """Return a new workspace with one additional source asset."""

    source_asset = SourceAsset(
        id=_next_source_asset_id(workspace),
        source_type=source_type,
        title=title,
        source_value=source_value,
    )

    return Workspace(
        id=workspace.id,
        name=workspace.name,
        active_module=workspace.active_module,
        source_assets=workspace.source_assets + (source_asset,),
    )


def import_source_with_mock_transcript(
    workspace: Workspace,
    source_type: str,
    title: str,
    source_value: str,
) -> Workspace:
    """Replace the active source and transcript with one newly imported pair."""

    source_asset = SourceAsset(
        id="src_001",
        source_type=source_type,
        title=title,
        source_value=source_value,
    )
    transcript_session = TranscriptSession(
        id="tx_001",
        source_asset_id=source_asset.id,
        transcript_text=build_mock_transcript(
            source_type=source_type,
            title=title,
            source_value=source_value,
        ),
        status="ready",
    )

    return Workspace(
        id=workspace.id,
        name=workspace.name,
        active_module=workspace.active_module,
        active_transcript_session=transcript_session,
        source_assets=(source_asset,),
    )
