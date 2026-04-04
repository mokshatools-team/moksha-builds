"""
place_overlays.py — DaVinci Resolve utility script for Text Overlay Assistant
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTALL (copy this file to one of these paths so Resolve finds it):
  Mac:     ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
  Windows: C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Fusion\\Scripts\\Utility\\

RUN:
  Workspace → Scripts → place_overlays

REQUIRES:
  • A timeline open in DaVinci Resolve
  • Three Fusion Title templates saved in your project/library (see TEMPLATE CONTRACT below)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEMPLATE CONTRACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create three Fusion Title templates and save them with EXACTLY these names:

  TOA_Chapter    → for CHAPTER highlights  (major section titles)
  TOA_List       → for LIST highlights     (enumerated items joined with " / ")
  TOA_Keyword    → for KEYWORD highlights  (short italic emphasis phrases)

Overlay duration is controlled by the composition length of each template.
Set it however long you want that type of highlight to stay on screen.
The script inserts at the right timecode and the template duration applies.

Inside EACH template:
  • Add a Text+ node
  • In the Nodes panel, rename that Text+ node to: OverlayText
    (double-click the node name to rename it)
  • Style it however you like — the script only replaces the text content

The script sets the text on "OverlayText" automatically.
If the node is missing or named differently, the template is still inserted
at the correct timecode — text will show whatever default you set.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRACK LAYOUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  V4  ──  CHAPTER highlights
  V3  ──  LIST highlights
  V2  ──  KEYWORD highlights

  V1 is left free for your main edit.
  Tracks are created automatically if they don't exist.
"""

# ──────────────────────────────────────────────────────────────────────────────
# CONFIG — edit these if you change template names, FPS, or track layout
# ──────────────────────────────────────────────────────────────────────────────

FPS = 24

# Exact names of your saved Fusion Title templates
TEMPLATES = {
    "CHAPTER": "TOA_Chapter",
    "LIST":    "TOA_List",
    "KEYWORD": "TOA_Keyword",
}

# The Text+ node name inside each template (rename it in the Nodes panel)
TEXT_NODE = "OverlayText"

# Which video track each type lands on (1-indexed; V1 is your main edit)
OVERLAY_TRACKS = {
    "CHAPTER": 4,
    "LIST":    3,
    "KEYWORD": 2,
}

# Duration is set by the Fusion template's composition length — not here.

# ──────────────────────────────────────────────────────────────────────────────
# SCRIPT
# ──────────────────────────────────────────────────────────────────────────────

import json
import sys
import tkinter as tk
from tkinter import filedialog, messagebox


# ── Timecode helpers ──────────────────────────────────────────────────────────

def time_str_to_total_seconds(time_str: str) -> int:
    """'1:23' → 83 seconds."""
    parts = time_str.strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    if len(parts) == 3:                          # H:MM:SS from very long videos
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    raise ValueError(f"Cannot parse time string: {time_str!r}")


def seconds_to_frames(secs: int) -> int:
    return secs * FPS


def frames_to_timecode(total_frames: int) -> str:
    """Absolute frame count → 'HH:MM:SS:FF'."""
    h  = total_frames // (FPS * 3600)
    m  = (total_frames % (FPS * 3600)) // (FPS * 60)
    s  = (total_frames % (FPS * 60)) // FPS
    f  = total_frames % FPS
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def timecode_to_frames(tc: str) -> int:
    """'HH:MM:SS:FF' → absolute frame count."""
    parts = [int(x) for x in tc.replace(";", ":").split(":")]
    return parts[0] * FPS * 3600 + parts[1] * FPS * 60 + parts[2] * FPS + parts[3]


# ── Resolve helpers ───────────────────────────────────────────────────────────

def get_resolve():
    """Get the Resolve object whether the script is run from the console or
    from the Scripts menu (where DaVinciResolveScript is available)."""
    try:
        import DaVinciResolveScript as dvr
        return dvr.scriptapp("Resolve")
    except (ImportError, AttributeError):
        pass
    # Inside Resolve's own Python console 'app' is injected as a global
    try:
        return app.GetResolve()   # noqa: F821
    except NameError:
        return None


def ensure_video_tracks(timeline, needed: int) -> bool:
    """Add video tracks until there are at least `needed`."""
    while timeline.GetTrackCount("video") < needed:
        if not timeline.AddTrack("video"):
            return False
    return True


def set_overlay_text(clip, text: str) -> bool:
    """Write `text` into the OverlayText node of the clip's Fusion comp."""
    try:
        comp = clip.GetFusionCompByIndex(1)
        if not comp:
            return False
        tool = comp.FindTool(TEXT_NODE)
        if not tool:
            return False
        comp.Lock()
        try:
            tool.StyledText[0] = text
        finally:
            comp.Unlock()
        return True
    except Exception:
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # ── Connect to Resolve ──
    resolve = get_resolve()
    if not resolve:
        messagebox.showerror(
            "Text Overlay Assistant",
            "Cannot connect to DaVinci Resolve.\n\n"
            "Make sure the script is running inside Resolve\n"
            "(Workspace → Scripts → place_overlays).",
        )
        return

    pm       = resolve.GetProjectManager()
    project  = pm.GetCurrentProject()
    timeline = project.GetCurrentTimeline() if project else None

    if not timeline:
        messagebox.showerror(
            "Text Overlay Assistant",
            "No timeline is currently open.\n"
            "Open a timeline, then run the script again.",
        )
        return

    # ── Pick the JSON file ──
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    json_path = filedialog.askopenfilename(
        title="Select Text Overlay JSON file",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
    )
    root.destroy()

    if not json_path:
        return  # user cancelled

    # ── Load the JSON ──
    try:
        with open(json_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        messagebox.showerror("Text Overlay Assistant", f"Could not read JSON file:\n{exc}")
        return

    overlays = data.get("overlays", [])
    project_name = data.get("project", "Unknown")

    if not overlays:
        messagebox.showinfo("Text Overlay Assistant", "No highlights found in the JSON file.")
        return

    # ── Ensure V2 / V3 / V4 exist ──
    max_track = max(OVERLAY_TRACKS.values())
    if not ensure_video_tracks(timeline, max_track):
        messagebox.showerror(
            "Text Overlay Assistant",
            f"Could not create {max_track} video tracks. "
            "Check that you have a timeline open with edit permissions.",
        )
        return

    # ── Find the timeline's start frame ──
    start_tc    = timeline.GetStartTimecode()
    start_frame = timecode_to_frames(start_tc)

    # ── Place overlays ──
    placed  = 0
    skipped = 0
    no_text = 0
    errors  = []

    for overlay in overlays:
        otype     = (overlay.get("type") or "").upper()
        text      = (overlay.get("text") or "").strip()
        time_str  = overlay.get("time", "0:00")

        template = TEMPLATES.get(otype)
        track    = OVERLAY_TRACKS.get(otype)

        if not template or not text:
            skipped += 1
            continue

        # Calculate absolute timecode for this overlay
        try:
            offset_secs   = time_str_to_total_seconds(time_str)
            offset_frames = seconds_to_frames(offset_secs)
            abs_frame     = start_frame + offset_frames
            timecode      = frames_to_timecode(abs_frame)
        except ValueError as exc:
            errors.append(f"[{time_str}] Bad timestamp — {exc}")
            skipped += 1
            continue

        # Move playhead to insert point
        timeline.SetCurrentTimecode(timecode)

        # Insert the Fusion title template.
        # Try the extended signature first (Resolve 18.5+); fall back to basic.
        # Duration comes from the template's own composition length — not passed here.
        clip = None
        try:
            clip = timeline.InsertFusionTitleIntoTimeline(template, abs_frame, track)
        except Exception:
            pass

        if not clip:
            # Basic insert — track placement is Resolve's choice
            clip = timeline.InsertFusionTitleIntoTimeline(template)

        if not clip:
            errors.append(
                f"[{time_str}] Could not insert template '{template}'. "
                f"Is the template saved with that exact name?"
            )
            skipped += 1
            continue

        # Write the overlay text into the Fusion comp
        text_ok = set_overlay_text(clip, text)
        if not text_ok:
            no_text += 1
            errors.append(
                f"[{time_str}] Template '{template}' inserted but text not set "
                f"(is the Text+ node named '{TEXT_NODE}'?)."
            )

        placed += 1

    # ── Summary dialog ──
    lines = [
        f"Project: {project_name}",
        f"",
        f"✓  {placed} highlights placed",
    ]
    if skipped:
        lines.append(f"—  {skipped} skipped (missing type or text)")
    if no_text:
        lines.append(
            f"⚠  {no_text} inserted without text "
            f"(rename the Text+ node to '{TEXT_NODE}')"
        )
    if errors:
        lines.append("")
        lines.append("Details:")
        lines += [f"  • {e}" for e in errors[:12]]
        if len(errors) > 12:
            lines.append(f"  … and {len(errors) - 12} more")

    messagebox.showinfo("Text Overlay Assistant — Done", "\n".join(lines))


# Entry point when launched from Resolve's Scripts menu
main()
