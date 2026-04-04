# Text Overlay Assistant

A local web app that accepts either a local video file or a YouTube URL, transcribes it, sends the transcript to Claude, and produces a structured JSON file of text overlays (chapters, lists, keywords) for use in DaVinci Resolve or other video editing tools.

---

## Requirements

- Python 3.9+
- An [OpenAI API key](https://platform.openai.com/api-keys/)
- An [Anthropic API key](https://console.anthropic.com/)
- `yt-dlp` available in your environment if you want to analyze YouTube URLs

---

## Install

```bash
cd text-overlay-assistant
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

---

## Set the API key

**Option A — `.env` file (recommended for local dev)**

Create a file named `.env` in the `text-overlay-assistant/` folder:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
WATCH_FOLDER_PATH=/absolute/path/to/watch-folder   # optional
GOOGLE_OAUTH_REDIRECT_URI=https://your-public-domain/auth/callback   # optional, useful for deployed YouTube OAuth
```

The app loads this automatically via `python-dotenv`.

**Option B — shell export**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Run locally

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## How to use

1. Upload a local media file or paste a YouTube URL.
2. Type a project name (e.g. `PaintingWalls_Ep3`).
3. Click **Analyze**. The app transcribes the source and asks Claude to identify overlays.
4. Review the outline on the next screen.
   - Toggle timestamps on/off with the **Show Timestamps** button.
   - Click **Redo** to go back and re-run the analysis.
5. Click **Approve & Download JSON** to save the file.
6. Move the downloaded `ProjectName.json` to your DaVinci scripts folder.

---

## JSON output format

```json
{
  "project": "ProjectName",
  "overlays": [
    {"time": "0:15", "type": "CHAPTER",  "text": "Surface Preparation"},
    {"time": "0:38", "type": "LIST",     "text": "TSP Cleaner / Spackling Compound / 120-grit Sandpaper"},
    {"time": "1:02", "type": "KEYWORD",  "text": "most important step"}
  ]
}
```

Overlay types:
- **CHAPTER** — major section transition (3–6 per video)
- **LIST** — enumerated items joined with ` / `
- **KEYWORD** — short memorable phrase from the transcript, displayed in italic

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Invalid YouTube URL" | Make sure the URL contains a valid video ID (e.g. `?v=...` or `youtu.be/...`). |
| "Could not download YouTube audio" | Confirm `yt-dlp` is installed and the video is public/reachable. |
| "Whisper transcription failed" | Confirm `OPENAI_API_KEY` is valid and has available quota. |
| "ANTHROPIC_API_KEY not set" | Add your key to `.env` or export it in your shell. |
| "OPENAI_API_KEY not set" | Add your key to `.env` or export it in your shell. |
| Network error / server not running | Make sure `python app.py` is running before opening the browser. |

---

## Deploy to Railway

1. Push this folder to a GitHub repository.

2. Go to [railway.app](https://railway.app), create a new project, and connect your repo.

3. Add the environment variable in the Railway dashboard:
   ```
   ANTHROPIC_API_KEY = sk-ant-...
   ```

   If you use YouTube account connect, also make sure your Google OAuth client allows the exact callback URL your app will use. You can either:
   - include the deployed callback inside your Google client secret JSON `redirect_uris`, or
   - set `GOOGLE_OAUTH_REDIRECT_URI=https://your-public-domain/auth/callback`

4. Railway detects the `Procfile` and runs `gunicorn app:app` automatically.

5. Your app will be live at the Railway-assigned URL for your deployed service.

> **Note:** `youtube-transcript-api` fetches captions from YouTube's servers. If Railway's IP range is ever blocked by YouTube, you may need to run the app locally or behind a residential proxy.

---

## Project structure

```
text-overlay-assistant/
├── app.py                # Flask backend
├── templates/
│   └── index.html        # Single-page frontend (HTML/CSS/JS)
├── place_overlays.py     # DaVinci Resolve script (copy to Resolve's Scripts folder)
├── requirements.txt
├── Procfile              # Railway / gunicorn entry point
├── .env                  # Your API key — never commit this
└── README.md
```

---

## DaVinci Resolve integration

The JSON file produced by Text Overlay Assistant is placed onto your timeline by `place_overlays.py`, a Python utility script that runs inside DaVinci Resolve.

### One-time setup (do this once per workstation)

#### 1. Install the script

Copy `place_overlays.py` to DaVinci Resolve's Scripts folder:

| Platform | Path |
|----------|------|
| Mac      | `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/` |
| Windows  | `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility\` |

Resolve will auto-detect it. You'll find it under **Workspace → Scripts → place_overlays**.

---

#### 2. Create three Fusion Title templates

In DaVinci Resolve, create three **Fusion Title** compositions and save them with these **exact** names:

| Template name | Used for |
|---------------|----------|
| `OA_Chapter`  | Major section titles |
| `OA_List`     | Enumerated items (e.g. "Tool A / Tool B / Tool C") |
| `OA_Keyword`  | Short emphasis phrases (italic) |

Style each one however you like (font, size, position, animation). The script only touches the text content — all visual styling stays intact.

**Critical step inside each template:**

1. Open the Fusion comp for the title
2. Add a **Text+** node (or use the existing one)
3. In the Nodes panel, **rename that Text+ node to exactly:** `OverlayText`
   - Double-click the node name to rename it
4. Save the template

> If the node isn't named `OverlayText`, the template will still be inserted at the right timecode — but the text won't be filled in automatically. The script will warn you which ones need manual text.

---

#### 3. Set the JSON destination

When Text Overlay Assistant's done screen says "move the JSON to your DaVinci scripts folder", this means the same Utility folder above (or any folder you prefer). The script shows a file picker so the editor just navigates to wherever the JSON was saved.

---

### Editor workflow (every project)

```
1. Open Text Overlay Assistant → upload a file or paste a YouTube URL → type project name → Analyze
2. Review the overlay outline, toggle timestamps if needed
3. Approve & Download JSON  →  ProjectName.json saves to Downloads
4. Open DaVinci Resolve → open the project timeline
5. Workspace → Scripts → place_overlays
6. Pick ProjectName.json in the file dialog
7. Done — overlays appear on V2 / V3 / V4 at the right timecodes
```

**Track layout:**

| Track | Type | Contents |
|-------|------|----------|
| V4    | CHAPTER  | Section title cards (4 s each) |
| V3    | LIST     | Item list cards (5 s each) |
| V2    | KEYWORD  | Italic emphasis phrases (3 s each) |

V1 is left free for your main edit.

---

### Troubleshooting the DaVinci script

| Problem | Fix |
|---------|-----|
| Script doesn't appear in Workspace → Scripts | Check the file is in the correct Utility folder and Resolve has been restarted |
| "Could not insert template OA_Chapter" | The template name doesn't match exactly — check for typos, capitalisation, and trailing spaces |
| Overlays inserted but text is empty | Rename the Text+ node inside the template to `OverlayText` |
| Overlays land on wrong tracks | Your version of Resolve may not support track-targeted insertion; drag them to V2/V3/V4 manually (timecodes are already correct) |
| "No timeline is open" | Switch to the Edit page and make sure a timeline tab is active |

---

## Changing the Claude model

The model is set in `app.py` on the `client.messages.create(...)` call. Default is `claude-opus-4-5`. You can swap it for any model in your Anthropic plan (e.g. `claude-sonnet-4-5` for faster, cheaper runs).
