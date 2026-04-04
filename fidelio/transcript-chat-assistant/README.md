# Transcript Chat Assistant

Standalone transcript-first web app for studying a video transcript without running overlay analysis.

## Features

- Upload a media file and extract a transcript
- Paste a public YouTube URL and fetch the transcript
- Connect a Google account and fetch owned YouTube captions
- Read the transcript directly in the app
- Copy the transcript or download it as `.txt` or `.md`
- Chat with an LLM using the active transcript as grounding context

## Local setup

```bash
cd transcript-chat-assistant
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000/`.

## Environment variables

- `OPENAI_API_KEY` for Whisper transcription
- `ANTHROPIC_API_KEY` for transcript chat
- `FLASK_SECRET_KEY` for session signing
- `GOOGLE_CLIENT_SECRETS_FILE` or `GOOGLE_CLIENT_SECRETS` for YouTube OAuth
- `ANTHROPIC_MODEL` optional, defaults to `claude-sonnet-4-5`

## Railway

This app is intended to deploy as its own Railway service, separate from `text-overlay-assistant`.

Railway will use:

- `Procfile` for Gunicorn startup
- `requirements.txt` for Python dependencies

Set the same environment variables in Railway before testing YouTube OAuth or transcript chat.
