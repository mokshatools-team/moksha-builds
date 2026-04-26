"""
Fidelio Pipeline — Thumbnail Generation
1. Load client project config from thumbnail-generator (if available)
2. Extract a representative frame from the export via ffmpeg
3. Send to FAL Nano Banana with brand-specific prompt + brand reference image
4. Save thumbnail to ~/.fidelio/thumbnails/
"""
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import fal_client

log = logging.getLogger("fidelio.thumbnail")

FFMPEG = os.getenv("FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg")
FAL_MODEL = "fal-ai/nano-banana-2"
FAL_EDIT_MODEL = "fal-ai/nano-banana-2/edit"

# Path to the thumbnail-generator project configs (sibling of fidelio-pipeline)
_THUMB_GEN_DIR = Path(__file__).parent.parent.parent.parent / "thumbnail-generator"
_PROJECTS_DIR = _THUMB_GEN_DIR / "projects"


def _load_project_config(client_id: str) -> dict | None:
    """Load brand project config from thumbnail-generator/projects/{client_id}.json."""
    config_path = _PROJECTS_DIR / f"{client_id}.json"
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                cfg = json.load(f)
            log.info(f"[Thumbnail] Loaded brand config: {client_id}")
            return cfg
        except Exception as e:
            log.warning(f"[Thumbnail] Could not load brand config for {client_id}: {e}")
    return None


def _default_reference_image_path(
    project: dict | None,
    client_id: str,
    content_type: str,
    generation_mode: str = "standard",
) -> Path | None:
    """Pick the best built-in style reference for this content type."""
    refs_dir = _THUMB_GEN_DIR / "references" / client_id
    if content_type == "short_form":
        ref_names = ("ig_stock.jpg", "ig_stock.png") if generation_mode == "stock" else ("ig_host.jpg", "ig_host.png")
        for name in ref_names:
            candidate = refs_dir / name
            if candidate.exists():
                return candidate
    if project:
        ref_str = project.get("reference_image", "")
        if ref_str:
            candidate = Path(ref_str).expanduser()
            if candidate.exists():
                return candidate
    return None


def _build_brand_prompt(project: dict, title: str) -> str:
    """Build a brand-aware FAL generation prompt from project config."""
    style = project.get("style_description", "")
    negative = project.get("negative_style", "")
    font = project.get("font_style", "bold white sans-serif")

    prompt = (
        f"{style} "
        f"Episode title displayed on image: \"{title}\" — rendered in {font}. "
        f"High contrast, clear at small sizes. Professional. "
    )
    if negative:
        prompt += f"Avoid: {negative}"
    return prompt.strip()


def _build_generic_prompt(profile: dict, title: str) -> str:
    """Fallback prompt when no project config is available."""
    colors = profile.get("colors", ["#FFFFFF", "#000000"])
    primary = colors[0] if colors else "#FFFFFF"
    accent = colors[-1] if len(colors) > 1 else "#000000"
    thumb_style = profile.get("thumbnail_style", "Clean minimal design with text overlay")
    keywords = _extract_keywords(title)
    return (
        f"Professional YouTube thumbnail. Style: {thumb_style}. "
        f"Color palette: {primary} and {accent}. "
        f"Clean bold text overlay with topic: {keywords}. "
        f"Medical/health professional aesthetic. High contrast. Readable at small size."
    )


def upload_ref_image(image_path: Path) -> str:
    """Upload a reference image to FAL storage and return the public URL."""
    import mimetypes
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    with open(image_path, "rb") as f:
        data = f.read()
    return fal_client.upload(data, content_type=mime)


def generate_thumbnail(
    export_path: Path,
    profile: dict,
    title: str,
    thumb_dir: Path,
    content_type: str = "long_form",
    generation_mode: str = "standard",
    stock_prompt: str = "",
    custom_prompt: str = "",
    ref_image_urls: list[str] | None = None,
    has_subject_frame: bool = False,
    subject_frame_count: int = 0,
    has_brand_reference: bool = False,
) -> Path | None:
    """
    Generate a brand-aware thumbnail via FAL Nano Banana.

    Loads client brand config from thumbnail-generator/projects/ if available.
    Falls back to generic prompt otherwise.

    ref_image_urls: pre-uploaded FAL public URLs to pass as image_urls (host frame,
    guest frame, brand ref). When provided, skips local frame extraction.

    Returns:
        Path to the saved thumbnail PNG, or None if generation fails.
    """
    thumb_path = thumb_dir / f"{export_path.stem}_thumb.png"

    if thumb_path.exists():
        log.info(f"[Thumbnail] Already exists: {thumb_path.name}")
        return thumb_path

    # ── Step 1: Load brand config ─────────────────────────────
    client_id = profile.get("client_id", "")
    project = _load_project_config(client_id) if client_id else None

    effective_has_subject_frame = has_subject_frame
    effective_subject_frame_count = subject_frame_count
    effective_has_brand_reference = has_brand_reference

    # ── Step 2: Choose reference images ──────────────────────
    # If caller provided explicit ref URLs (frame picker / brand ref selector),
    # skip local extraction entirely — use those directly.
    fal_image_urls: list[str] = list(ref_image_urls) if ref_image_urls else []

    frame_path = None
    if not fal_image_urls:
        brand_ref_path = _default_reference_image_path(project, client_id, content_type, generation_mode)
        if brand_ref_path and not brand_ref_path.exists():
            brand_ref_path = None

        auto_urls: list[str] = []
        if content_type == "short_form":
            log.info(f"[Thumbnail] Extracting frame from {export_path.name}...")
            frame_path = _extract_frame(export_path)
            if frame_path:
                try:
                    auto_urls.append(_upload_frame(frame_path))
                    effective_has_subject_frame = True
                    effective_subject_frame_count = max(effective_subject_frame_count, 1)
                except Exception as e:
                    log.warning(f"[Thumbnail] Could not upload subject frame: {e}")
            if brand_ref_path:
                try:
                    auto_urls.append(upload_ref_image(brand_ref_path))
                    effective_has_brand_reference = True
                except Exception as e:
                    log.warning(f"[Thumbnail] Could not upload style image: {e}")
        else:
            style_image_path = brand_ref_path
            if style_image_path:
                effective_has_brand_reference = True
            else:
                log.info(f"[Thumbnail] Extracting frame from {export_path.name}...")
                frame_path = _extract_frame(export_path)
                if not frame_path:
                    log.warning("[Thumbnail] Frame extraction failed — generating without reference")
                style_image_path = frame_path

            if style_image_path:
                try:
                    auto_urls = [_upload_frame(style_image_path)]
                except Exception as e:
                    log.warning(f"[Thumbnail] Could not upload style image: {e}")

        fal_image_urls = auto_urls

    # ── Step 3: Build prompt ──────────────────────────────────
    if custom_prompt.strip():
        prompt = custom_prompt.strip()
    elif content_type == "short_form" and generation_mode == "stock":
        stock_subject = stock_prompt.strip() or title
        prompt = (
            f"Create a vertical short-form cover image using a stock-photo-style visual concept that illustrates: "
            f"{stock_subject}. "
            f"Do not use the host or presenter as the main subject. "
            f"Generate a NEW scene that matches the topic of the video. "
            f"The reference image is for layout, typography, and design treatment only. "
            f"Do NOT copy or recreate the literal subject, props, framing, or scene from the reference image unless they genuinely match the topic above. "
            f"Prefer one clear medical object, one clear person, or one clear scene rather than a cluttered collage. "
            f"Copy the visual style of the final reference image as literally as possible. "
            f"Use the same color, font style, text treatment, and overall design feel. "
            f"Do not reinterpret, modernize, or redesign the style reference. "
            f"Cover text: \"{title}\"."
        )
    elif content_type == "short_form" and effective_has_brand_reference:
        prompt = (
            f"Create a vertical short-form cover image. "
            f"Copy the visual style of the final reference image as literally as possible. "
            f"Use the same color, font style, text treatment, and overall design feel. "
            f"Do not reinterpret, modernize, or redesign the style reference. "
            f"Cover text: \"{title}\"."
        )
    elif project and effective_has_brand_reference:
        prompt = (
            f"Copy the visual style of the final reference image as literally as possible. "
            f"Use the same color, same font style, same text treatment, and same overall design feel. "
            f"Do not reinterpret, modernize, or redesign the style reference. "
            f"Episode title displayed on image: \"{title}\"."
        )
    elif project:
        prompt = _build_brand_prompt(project, title)
    else:
        prompt = _build_generic_prompt(profile, title)

    if generation_mode != "stock" and effective_subject_frame_count >= 2:
        prompt = (
            f"IMPORTANT: The first two reference photos are the real on-camera subjects for this thumbnail. "
            f"Use BOTH of them as the two people in the final design, with one person on the left and one on the right. "
            f"Preserve each person's real face, hair, skin tone, clothing, and microphone details from their respective "
            f"reference photo. If the first two reference photos show the same woman, show that same real woman twice in "
            f"two separate positions rather than inventing a different guest. Treat those subject photos as identity "
            f"references only - do not paste the raw video frames or keep their original office background. Restage them "
            f"as clean cut-out subjects inside the thumbnail design. "
            f"{prompt} "
            f"The thumbnail must contain both real subjects from the first two reference photos, not stock or AI-invented people."
        )
    elif generation_mode != "stock" and effective_has_subject_frame:
        prompt = (
            f"IMPORTANT: Use ONLY the real person shown in the first reference photo as the "
            f"thumbnail subject. Do NOT generate or invent a person - show the actual person "
            f"from the photo with their real face, hair, and clothing. "
            f"{prompt} "
            f"The thumbnail must show the specific real person from the reference image, "
            f"not a stock or AI-generated person."
        )
    if effective_has_brand_reference:
        prompt = (
            f"IMPORTANT: The final reference image is the style source of truth. "
            f"Follow it directly for color, font style, text treatment, and graphic feel. "
            f"If the subject reference photos conflict with the style reference, keep the people but obey the final style reference for the design. "
            f"Do not restyle or reinterpret it. "
            f"{prompt} "
            f"Keep the output in the same design family as the final style reference image."
        )

    log.info(f"[Thumbnail] Prompt: {prompt[:120]}...")

    # ── Step 4: Call FAL ──────────────────────────────────────
    try:
        weighted_image_urls = list(fal_image_urls)
        if effective_has_brand_reference and weighted_image_urls and generation_mode != "stock":
            # Give the final style ref extra influence without disturbing subject ref order.
            weighted_image_urls.extend([weighted_image_urls[-1], weighted_image_urls[-1]])

        aspect_ratio = "9:16" if content_type == "short_form" else "16:9"
        fal_args = {
            "prompt": prompt,
            "num_images": 1,
            "aspect_ratio": aspect_ratio,
            "resolution": "0.5K",
        }
        model_id = FAL_MODEL
        if weighted_image_urls:
            fal_args["image_urls"] = weighted_image_urls
            model_id = FAL_EDIT_MODEL

        log.info(f"[Thumbnail] Calling FAL Nano Banana model={model_id} ({len(weighted_image_urls)} ref images)...")
        result = fal_client.run(model_id, arguments=fal_args)
        image_url = result["images"][0]["url"]
        _download_image(image_url, thumb_path)
        log.info(f"[Thumbnail] Saved: {thumb_path.name}")
        return thumb_path

    except Exception as e:
        log.error(f"[Thumbnail] FAL generation failed: {e}")
        return None
    finally:
        if frame_path and frame_path.exists():
            frame_path.unlink(missing_ok=True)


def _extract_frame(video_path: Path) -> Path | None:
    """Extract a frame at 10% into the video to avoid black frames."""
    return _extract_frame_at(video_path, 0.10)


def _extract_frame_at(video_path: Path, t: float) -> Path | None:
    """Extract a frame at position t (0.0–1.0) into the video."""
    try:
        probe_cmd = [
            "/opt/homebrew/bin/ffprobe", "-v", "quiet",
            "-print_format", "json", "-show_format", str(video_path)
        ]
        probe = subprocess.run(probe_cmd, capture_output=True, text=True)
        duration = float(json.loads(probe.stdout)["format"]["duration"])
        seek_time = duration * t

        frame_path = Path(tempfile.mktemp(suffix=".jpg"))
        cmd = [
            FFMPEG, "-y",
            "-ss", str(seek_time),
            "-i", str(video_path),
            "-vframes", "1", "-q:v", "2",
            str(frame_path)
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        return frame_path if frame_path.exists() else None
    except Exception as e:
        log.warning(f"[Thumbnail] Frame extraction error: {e}")
        return None


def _upload_frame(frame_path: Path) -> str:
    """Upload image to FAL storage and return URL."""
    with open(frame_path, "rb") as f:
        data = f.read()
    url = fal_client.upload(data, content_type="image/jpeg")
    return url


def _download_image(url: str, dest: Path):
    """Download the generated image from FAL CDN."""
    import urllib.request
    urllib.request.urlretrieve(url, dest)


def _extract_keywords(title: str, max_words: int = 5) -> str:
    """Pull meaningful words from title, filtering French stop words."""
    stop_words = {
        "le", "la", "les", "de", "du", "des", "un", "une", "et", "ou",
        "en", "au", "aux", "par", "sur", "pour", "avec", "dans", "ce",
        "qui", "que", "est", "sont", "mais", "donc", "or", "ni", "car",
        "the", "a", "an", "of", "in", "on", "at", "to", "for", "with",
    }
    words = [w.strip(",:!?") for w in title.split() if w.lower().strip(",:!?") not in stop_words]
    return ", ".join(words[:max_words])
