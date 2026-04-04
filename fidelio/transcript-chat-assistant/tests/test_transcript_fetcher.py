import os
import sys
import tempfile
import unittest
from unittest import mock

import transcript_fetcher


class TranscriptFetcherTests(unittest.TestCase):
    def test_detects_youtube_watch_url(self):
        self.assertTrue(transcript_fetcher.is_youtube_url("https://www.youtube.com/watch?v=abc123"))

    @mock.patch("transcript_fetcher.transcribe_plain_text", return_value="hello world")
    def test_existing_local_file_returns_plain_transcript(self, transcribe_plain_text):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media_file:
            result = transcript_fetcher.fetch_transcript(media_file.name)

        self.assertEqual(result, "hello world")
        transcribe_plain_text.assert_called_once_with(media_file.name)

    @mock.patch("transcript_fetcher.subprocess.run")
    @mock.patch("transcript_fetcher.os.listdir", return_value=["source.mp3"])
    @mock.patch("transcript_fetcher.os.path.isfile", return_value=True)
    def test_download_youtube_audio_uses_python_module_invocation(
        self,
        isfile_mock,
        listdir_mock,
        run_mock,
    ):
        run_mock.return_value = mock.Mock()

        with mock.patch("transcript_fetcher.tempfile.mkdtemp", return_value="/tmp/transcript-chat-ytdlp"):
            result = transcript_fetcher.download_youtube_audio("https://youtu.be/abc123")

        self.assertEqual(result, "/tmp/transcript-chat-ytdlp/source.mp3")
        command = run_mock.call_args[0][0]
        self.assertEqual(command[:3], [sys.executable, "-m", "yt_dlp"])

    @mock.patch("transcript_fetcher.subprocess.run")
    def test_fetch_youtube_title_uses_yt_dlp_print_mode(self, run_mock):
        run_mock.return_value = mock.Mock(stdout="Title From yt-dlp\n")

        result = transcript_fetcher.fetch_youtube_title("https://youtu.be/abc123")

        self.assertEqual(result, "Title From yt-dlp")
        command = run_mock.call_args[0][0]
        self.assertEqual(command[:3], [sys.executable, "-m", "yt_dlp"])
