import unittest
from dataclasses import FrozenInstanceError

from app.models.contracts import IMPORT_MODULE, SourceAsset, TranscriptSession, Workspace


class ModelContractTests(unittest.TestCase):
    def test_transcript_session_keeps_core_fields(self):
        transcript = TranscriptSession(
            id="tx_1",
            source_asset_id="src_1",
            transcript_text="Full transcript text.",
            status="ready",
        )

        self.assertEqual(transcript.id, "tx_1")
        self.assertEqual(transcript.source_asset_id, "src_1")
        self.assertEqual(transcript.transcript_text, "Full transcript text.")
        self.assertEqual(transcript.status, "ready")

    def test_source_asset_keeps_core_fields(self):
        asset = SourceAsset(
            id="src_1",
            source_type="upload",
            title="Episode 12",
            source_value="episode-12.mp4",
        )

        self.assertEqual(asset.id, "src_1")
        self.assertEqual(asset.source_type, "upload")
        self.assertEqual(asset.title, "Episode 12")
        self.assertEqual(asset.source_value, "episode-12.mp4")

    def test_workspace_includes_identity_fields_and_empty_source_assets(self):
        workspace = Workspace(id="ws-001", name="Main workspace", active_module=IMPORT_MODULE)

        self.assertEqual(workspace.id, "ws-001")
        self.assertEqual(workspace.name, "Main workspace")
        self.assertEqual(workspace.active_module, IMPORT_MODULE)
        self.assertIsNone(workspace.active_transcript_session)
        self.assertEqual(workspace.source_assets, ())
        self.assertEqual(workspace.source_asset_ids, ())

    def test_workspace_can_expose_an_active_transcript_session(self):
        transcript = TranscriptSession(
            id="tx_1",
            source_asset_id="src_1",
            transcript_text="Full transcript text.",
            status="ready",
        )
        workspace = Workspace(
            id="ws-001",
            name="Main workspace",
            active_module=IMPORT_MODULE,
            active_transcript_session=transcript,
        )

        self.assertEqual(workspace.active_transcript_session.id, "tx_1")

    def test_workspace_source_asset_ids_are_derived_from_a_valid_non_empty_workspace(self):
        workspace = Workspace(
            id="ws-001",
            name="Main workspace",
            active_module=IMPORT_MODULE,
            source_assets=(
                SourceAsset(
                    id="src_1",
                    source_type="upload",
                    title="Episode 12",
                    source_value="episode-12.mp4",
                ),
                SourceAsset(
                    id="src_2",
                    source_type="url",
                    title="Reference clip",
                    source_value="https://example.com/clip.mp4",
                ),
            ),
        )

        self.assertEqual(workspace.source_assets[0].id, "src_1")
        self.assertEqual(workspace.source_assets[1].id, "src_2")
        self.assertEqual(workspace.source_asset_ids, ("src_1", "src_2"))

    def test_workspace_rejects_duplicate_source_assets_after_init(self):
        with self.assertRaises(ValueError):
            Workspace(
                id="ws-001",
                name="Main workspace",
                active_module=IMPORT_MODULE,
                source_assets=(
                    SourceAsset(
                        id="src_1",
                        source_type="upload",
                        title="Episode 12",
                        source_value="episode-12.mp4",
                    ),
                    SourceAsset(
                        id="src_1",
                        source_type="url",
                        title="Reference clip",
                        source_value="https://example.com/clip.mp4",
                    ),
                ),
            )

    def test_workspace_rejects_duplicate_source_assets_after_reassignment(self):
        workspace = Workspace(
            id="ws-001",
            name="Main workspace",
            active_module=IMPORT_MODULE,
            source_assets=(
                SourceAsset(
                    id="src_1",
                    source_type="upload",
                    title="Episode 12",
                    source_value="episode-12.mp4",
                ),
            )
        )

        with self.assertRaises(ValueError):
            workspace.source_assets = workspace.source_assets + (
                SourceAsset(
                    id="src_1",
                    source_type="url",
                    title="Reference clip",
                    source_value="https://example.com/clip.mp4",
                ),
            )

    def test_source_asset_id_cannot_be_mutated_after_workspace_insertion(self):
        asset = SourceAsset(
            id="src_1",
            source_type="upload",
            title="Episode 12",
            source_value="episode-12.mp4",
        )
        workspace = Workspace(
            id="ws-001",
            name="Main workspace",
            active_module=IMPORT_MODULE,
            source_assets=(asset,),
        )

        with self.assertRaises(FrozenInstanceError):
            workspace.source_assets[0].id = "src_2"
