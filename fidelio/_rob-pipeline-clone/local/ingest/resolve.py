"""
Fidelio Pipeline — DaVinci Resolve Integration
Uses the DaVinci Resolve Python scripting API directly.
Resolve must be open for any of these calls to work.
"""
import logging
import sys
from pathlib import Path

log = logging.getLogger("fidelio.resolve")

RESOLVE_SCRIPT_MODULES = (
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules"
)


def _get_resolve():
    """Get the Resolve scripting object. Returns None if Resolve isn't open."""
    if RESOLVE_SCRIPT_MODULES not in sys.path:
        sys.path.append(RESOLVE_SCRIPT_MODULES)
    try:
        import DaVinciResolveScript as dvr
        resolve = dvr.scriptapp("Resolve")
        if resolve is None:
            log.warning("Resolve is not open — skipping Resolve integration")
        return resolve
    except (ImportError, Exception) as e:
        log.warning(f"Could not connect to Resolve: {e}")
        return None


def setup_project(clip_paths: list[Path], shoot_date: str, project_name: str = None) -> bool:
    """
    Import clips into Resolve and organise into a dated bin.

    Args:
        clip_paths: list of video file paths to import
        shoot_date: formatted date string e.g. "Apr 4, 2026" — used as bin name
        project_name: if provided, create/open a project with this name

    Returns:
        True if successful, False if Resolve unavailable
    """
    resolve = _get_resolve()
    if not resolve:
        return False

    pm = resolve.GetProjectManager()
    if not pm:
        log.error("Could not get ProjectManager from Resolve")
        return False

    # Open or create project
    if project_name:
        project = pm.LoadProject(project_name)
        if not project:
            project = pm.CreateProject(project_name)
            if not project:
                log.error(f"Could not create project: {project_name}")
                return False
            log.info(f"Created Resolve project: {project_name}")
        else:
            log.info(f"Opened Resolve project: {project_name}")
    else:
        project = pm.GetCurrentProject()
        if not project:
            log.error("No current project open in Resolve")
            return False

    media_pool = project.GetMediaPool()
    if not media_pool:
        log.error("Could not access Media Pool")
        return False

    # Create bin named by shoot date
    root_folder = media_pool.GetRootFolder()
    bin_name = shoot_date

    # Check if bin already exists
    existing_bins = {f.GetName(): f for f in root_folder.GetSubFolderList()}
    if bin_name in existing_bins:
        target_bin = existing_bins[bin_name]
        log.info(f"Using existing bin: {bin_name}")
    else:
        target_bin = media_pool.AddSubFolder(root_folder, bin_name)
        if not target_bin:
            log.error(f"Could not create bin: {bin_name}")
            return False
        log.info(f"Created bin: {bin_name}")

    # Set as active bin and import clips
    media_pool.SetCurrentFolder(target_bin)
    str_paths = [str(p) for p in clip_paths]
    imported = media_pool.ImportMedia(str_paths)

    if not imported:
        log.warning("No clips imported — they may already be in the pool")
    else:
        log.info(f"Imported {len(imported)} clips into bin '{bin_name}'")

    return True


def add_clip_markers(clip_paths: list[Path], transcripts: dict[str, str]) -> bool:
    """
    Add transcript markers to clips in the Media Pool.

    Args:
        clip_paths: list of clip paths
        transcripts: dict mapping clip stem -> first 100 chars of transcript text

    Returns:
        True if successful
    """
    resolve = _get_resolve()
    if not resolve:
        return False

    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        return False

    media_pool = project.GetMediaPool()
    root_folder = media_pool.GetRootFolder()

    # Build a map of clip name -> MediaPoolItem
    clip_map = {}
    _collect_clips(root_folder, clip_map)

    added = 0
    for clip_path in clip_paths:
        stem = clip_path.stem
        marker_text = transcripts.get(stem, "")
        if not marker_text:
            continue

        item = clip_map.get(clip_path.name) or clip_map.get(stem)
        if not item:
            log.warning(f"Clip not found in Media Pool: {clip_path.name}")
            continue

        # Add marker at frame 0 with transcript text (blue)
        success = item.AddMarker(
            frameId=0,
            color="Blue",
            name="Transcript",
            note=marker_text,
            duration=1
        )
        if success:
            added += 1

    log.info(f"Added transcript markers to {added}/{len(clip_paths)} clips")
    return True


def _collect_clips(folder, clip_map: dict):
    """Recursively collect all MediaPoolItems into a name->item dict."""
    for clip in folder.GetClipList():
        name = clip.GetName()
        clip_map[name] = clip
        # Also index by stem (without extension)
        stem = Path(name).stem
        clip_map[stem] = clip
    for sub in folder.GetSubFolderList():
        _collect_clips(sub, clip_map)


# Colour wheel for timeline — one colour per unique shoot date
_DATE_COLOURS = ["Blue", "Green", "Yellow", "Orange", "Pink", "Purple", "Teal", "Red"]


def _parse_shoot_date(date_str: str):
    """Parse shoot date string to datetime for sorting. Returns datetime.min on failure."""
    from datetime import datetime
    for fmt in ("%b %d, %Y", "%b  %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return datetime.min


def build_timeline(
    clips_data: list[dict],
    timeline_name: str,
    project_name: str = None,
) -> bool:
    """
    Assemble an ordered, colour-coded Resolve timeline from ingested clips.

    Args:
        clips_data: list of dicts with keys: path (Path), shoot_date (str), transcript_snippet (str)
        timeline_name: name for the new timeline (e.g. "FIDELIO_Apr 4 2026")
        project_name: open/create this project, or use current project if None

    Returns:
        True if successful, False if Resolve unavailable or failed
    """
    resolve = _get_resolve()
    if not resolve:
        return False

    pm = resolve.GetProjectManager()
    if not pm:
        log.error("Could not get ProjectManager from Resolve")
        return False

    # Open or use current project
    if project_name:
        project = pm.LoadProject(project_name)
        if not project:
            project = pm.CreateProject(project_name)
        if not project:
            log.error(f"Could not open/create project: {project_name}")
            return False
    else:
        project = pm.GetCurrentProject()
        if not project:
            log.error("No current project open in Resolve")
            return False

    media_pool = project.GetMediaPool()
    if not media_pool:
        log.error("Could not access Media Pool")
        return False

    # Sort clips: by shoot_date then filename
    sorted_clips = sorted(
        clips_data,
        key=lambda c: (_parse_shoot_date(c.get("shoot_date", "")), str(c.get("path", ""))),
    )

    # Assign a colour per unique shoot date
    date_colour: dict[str, str] = {}
    colour_idx = 0
    for clip in sorted_clips:
        d = clip.get("shoot_date", "")
        if d and d not in date_colour:
            date_colour[d] = _DATE_COLOURS[colour_idx % len(_DATE_COLOURS)]
            colour_idx += 1

    # Build clip map from media pool
    root_folder = media_pool.GetRootFolder()
    clip_map: dict[str, object] = {}
    _collect_clips(root_folder, clip_map)

    # Set clip colours in Media Pool
    for clip in sorted_clips:
        path = clip.get("path")
        if not path:
            continue
        item = clip_map.get(Path(path).name) or clip_map.get(Path(path).stem)
        if not item:
            log.warning(f"Clip not in Media Pool (import it first): {Path(path).name}")
            continue
        colour = date_colour.get(clip.get("shoot_date", ""), "Blue")
        item.SetClipColor(colour)

    # Create timeline and append clips in order
    timeline = media_pool.CreateEmptyTimeline(timeline_name)
    if not timeline:
        log.error(f"Could not create timeline: {timeline_name}")
        return False

    appended = 0
    for clip in sorted_clips:
        path = clip.get("path")
        if not path:
            continue
        item = clip_map.get(Path(path).name) or clip_map.get(Path(path).stem)
        if not item:
            continue
        result = media_pool.AppendToTimeline([{"mediaPoolItem": item}])
        if result:
            appended += 1

    project.SetCurrentTimeline(timeline)
    log.info(
        f"Built timeline '{timeline_name}': {appended}/{len(sorted_clips)} clips, "
        f"{len(date_colour)} shoot date(s) colour-coded"
    )
    return True
