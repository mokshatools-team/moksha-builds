import os
import sys
import tempfile
import unittest
from unittest import mock

import transcript_fetcher


class TranscriptFetcherTests(unittest.TestCase):
    def test_detects_youtube_watch_url(self):
        self.assertTrue(transcript_fetcher.is_youtube_url("https://www.youtube.com/watch?v=abc123"))

    def test_missing_file_path_raises_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            transcript_fetcher.fetch_transcript("/tmp/does-not-exist.mp4")

    @mock.patch("transcript_fetcher.transcribe_plain_text", return_value="hello world")
    def test_existing_local_file_returns_plain_transcript(self, transcribe_plain_text):
        with tempfile.NamedTemporaryFile(suffix=".mp4") as media_file:
            result = transcript_fetcher.fetch_transcript(media_file.name)

        self.assertEqual(result, "hello world")
        transcribe_plain_text.assert_called_once_with(media_file.name)

    @mock.patch("transcript_fetcher.download_youtube_audio")
    @mock.patch("transcript_fetcher.transcribe_plain_text", return_value="video transcript")
    def test_youtube_url_downloads_then_transcribes_and_cleans_up(self, transcribe_plain_text, download_youtube_audio):
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as media_file:
            temp_path = media_file.name

        download_youtube_audio.return_value = temp_path

        result = transcript_fetcher.fetch_transcript("https://youtu.be/abc123")

        self.assertEqual(result, "video transcript")
        transcribe_plain_text.assert_called_once_with(temp_path)
        download_youtube_audio.assert_called_once_with("https://youtu.be/abc123")
        self.assertFalse(os.path.exists(temp_path))

    @mock.patch("transcript_fetcher.subprocess.run")
    @mock.patch("transcript_fetcher.os.listdir", return_value=["source.mp3"])
    @mock.patch("transcript_fetcher.os.path.isfile", return_value=True)
    def test_download_youtube_audio_uses_python_module_invocation(self, isfile_mock, listdir_mock, run_mock):
        run_mock.return_value = mock.Mock()

        with mock.patch("transcript_fetcher.tempfile.mkdtemp", return_value="/tmp/toa-ytdlp-test"):
            result = transcript_fetcher.download_youtube_audio("https://youtu.be/abc123")

        self.assertEqual(result, "/tmp/toa-ytdlp-test/source.mp3")
        command = run_mock.call_args[0][0]
        self.assertEqual(command[:3], [sys.executable, "-m", "yt_dlp"])
        isfile_mock.assert_called_once_with("/tmp/toa-ytdlp-test/source.mp3")
        listdir_mock.assert_called_once_with("/tmp/toa-ytdlp-test")
