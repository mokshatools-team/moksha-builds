"""Shared dataclass contracts for Video Post Studio."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Optional

IMPORT_MODULE = "import"


@dataclass(frozen=True)
class SourceAsset:
    """Normalized representation of a source item stored in a workspace."""

    id: str
    source_type: str
    title: str
    source_value: str


@dataclass(frozen=True)
class TranscriptSession:
    """Normalized representation of an active transcript for a source asset."""

    id: str
    source_asset_id: str
    transcript_text: str
    status: str


@dataclass(init=False)
class Workspace:
    """Top-level project container for shared source references."""

    id: str
    name: str
    active_module: str
    active_transcript_session: Optional[TranscriptSession]
    _source_assets: tuple[SourceAsset, ...] = field(default=(), repr=False, compare=False)

    def __init__(
        self,
        id: str,
        name: str,
        active_module: str,
        active_transcript_session: Optional[TranscriptSession] = None,
        source_assets: Iterable[SourceAsset] = (),
    ) -> None:
        self.id = id
        self.name = name
        self.active_module = active_module
        self.active_transcript_session = active_transcript_session
        self.source_assets = source_assets

    @property
    def source_assets(self) -> tuple[SourceAsset, ...]:
        return self._source_assets

    @property
    def source_asset_ids(self) -> tuple[str, ...]:
        return tuple(asset.id for asset in self._source_assets)

    @source_assets.setter
    def source_assets(self, value: Iterable[SourceAsset]) -> None:
        assets = tuple(value)
        asset_ids = [asset.id for asset in assets]

        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("Workspace source_assets must have unique ids.")

        self._source_assets = assets
