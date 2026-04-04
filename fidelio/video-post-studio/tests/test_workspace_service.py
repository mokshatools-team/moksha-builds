import unittest

from app.models.contracts import IMPORT_MODULE, Workspace
from app.services.transcripts import build_mock_transcript
from app.services.workspaces import (
    add_source_asset,
    build_demo_workspace,
    import_source_with_mock_transcript,
)


class WorkspaceServiceTests(unittest.TestCase):
    def test_build_demo_workspace_returns_expected_demo_workspace(self):
        workspace = build_demo_workspace()

        self.assertEqual(workspace.id, "ws_demo")
        self.assertEqual(workspace.name, "Demo Workspace")
        self.assertEqual(workspace.active_module, IMPORT_MODULE)

    def test_build_demo_workspace_can_set_active_module(self):
        workspace = build_demo_workspace(active_module="toa")

        self.assertEqual(workspace.active_module, "toa")

    def test_add_source_asset_returns_workspace_with_appended_asset(self):
        workspace = Workspace(id="ws_001", name="Workspace", active_module=IMPORT_MODULE)

        updated_workspace = add_source_asset(
            workspace,
            source_type="upload",
            title="Episode 1",
            source_value="episode-1.mp4",
        )

        self.assertIsNot(updated_workspace, workspace)
        self.assertEqual(workspace.source_assets, ())
        self.assertEqual(len(updated_workspace.source_assets), 1)
        self.assertEqual(updated_workspace.source_assets[0].source_type, "upload")
        self.assertEqual(updated_workspace.source_assets[0].title, "Episode 1")
        self.assertEqual(updated_workspace.source_assets[0].source_value, "episode-1.mp4")
        self.assertEqual(len(updated_workspace.source_asset_ids), 1)
        self.assertTrue(updated_workspace.source_asset_ids[0].startswith("src_"))

    def test_build_mock_transcript_returns_deterministic_transcript_text(self):
        transcript_text = build_mock_transcript(
            source_type="upload",
            title="Episode 1",
            source_value="episode-1.mp4",
        )

        self.assertEqual(
            transcript_text,
            "Mock transcript for Episode 1 from upload: episode-1.mp4",
        )

    def test_import_source_with_mock_transcript_replaces_workspace_source_and_transcript(self):
        existing_workspace = Workspace(
            id="ws_001",
            name="Workspace",
            active_module=IMPORT_MODULE,
        )
        workspace = add_source_asset(
            existing_workspace,
            source_type="public_url",
            title="Old Source",
            source_value="https://example.com/old",
        )

        updated_workspace = import_source_with_mock_transcript(
            workspace,
            source_type="upload",
            title="Episode 1",
            source_value="episode-1.mp4",
        )

        self.assertIsNot(updated_workspace, workspace)
        self.assertEqual(len(updated_workspace.source_assets), 1)
        self.assertEqual(updated_workspace.source_assets[0].title, "Episode 1")
        self.assertEqual(updated_workspace.source_assets[0].source_value, "episode-1.mp4")
        self.assertEqual(updated_workspace.source_asset_ids, ("src_001",))
        self.assertIsNotNone(updated_workspace.active_transcript_session)
        self.assertEqual(updated_workspace.active_transcript_session.id, "tx_001")
        self.assertEqual(
            updated_workspace.active_transcript_session.source_asset_id,
            updated_workspace.source_assets[0].id,
        )
        self.assertEqual(updated_workspace.active_transcript_session.status, "ready")
        self.assertIn(
            "Episode 1",
            updated_workspace.active_transcript_session.transcript_text,
        )
