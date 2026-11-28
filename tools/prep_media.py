#!/usr/bin/env python3
"""Shrink a photo or video clip for the app and attach it to an item.

  python3 tools/prep_media.py SOURCE ITEM_ID --alt "What the shot shows"
  python3 tools/prep_media.py clip.MP4 slow-motion --alt "Surfer in slow motion" \
      --credit "Jane Doe" --credit-url https://example.com --license "CC BY 4.0"

Photos: longest side 1600 px, JPEG, metadata (GPS, camera serial) removed,
kept under PHOTO_MAX bytes.
Videos: longest side 1280 px (720p), H.264, max 30 fps, no sound unless
--audio, cut to --seconds (default 15), metadata removed, plus a poster frame.

Files are written to media/ with a short content hash in the name
(media/milky-way.3f2a1c.jpg), so phones never keep an old copy after a
replacement. The item's previous media files are deleted and its "media"
field in content/ is rewritten. Needs ffmpeg and Pillow.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent
CONTENT = REPO / "content"
MEDIA = REPO / "media"

PHOTO_EDGE = 1600
PHOTO_MAX = 450_000
VIDEO_EDGE = 1280
VIDEO_MAX = 6_000_000
POSTER_MAX = 250_000
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".webm", ".lrf", ".insv"}


def find_item(item_id):
    for folder in ("guides", "lessons", "basics"):
        p = CONTENT / folder / f"{item_id}.json"
        if p.exists():
            return p
    sys.exit(f"No item with id {item_id!r} in content/guides, lessons or basics.")


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("ffmpeg failed:\n" + r.stderr[-2000:])


def short_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:6]


def save_jpeg(img, out, max_bytes):
    """Save as progressive JPEG, lowering quality until it fits."""
    img = img.convert("RGB")
    for q in (82, 76, 70, 64, 58):
        img.save(out, "JPEG", quality=q, optimize=True, progressive=True)
        if out.stat().st_size <= max_bytes:
            return
    # Still too big: shrink the image instead.
    img.thumbnail((img.width * 3 // 4, img.height * 3 // 4))
    save_jpeg(img, out, max_bytes)


def open_image(src, tmp):
    from PIL import Image, ImageOps
    try:
        try:
            import pillow_heif  # iPhone HEIC, if installed
            pillow_heif.register_heif_opener()
        except ImportError:
            pass
        img = Image.open(src)
        img.load()
    except Exception:
        # Formats Pillow can't read (HEIC without pillow-heif, some RAW previews): let ffmpeg convert.
        png = tmp / "in.png"
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-frames:v", "1", str(png)])
        img = Image.open(png)
        img.load()
    return ImageOps.exif_transpose(img)


def prep_photo(src, item_id, tmp):
    img = open_image(src, tmp)
    img.thumbnail((PHOTO_EDGE, PHOTO_EDGE))
    out = tmp / "photo.jpg"
    save_jpeg(img, out, PHOTO_MAX)  # a fresh save carries no EXIF/GPS
    return {"kind": "photo", "files": [(out, f"{item_id}.{{h}}.jpg", "src")], "size": img.size}


def prep_video(src, item_id, tmp, args):
    out = tmp / "clip.mp4"
    scale = (f"scale='min({VIDEO_EDGE},iw)':'min({VIDEO_EDGE},ih)'"
             ":force_original_aspect_ratio=decrease:force_divisible_by=2")
    crf = 27
    while True:
        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        if args.start:
            cmd += ["-ss", str(args.start)]
        cmd += ["-i", str(src), "-t", str(args.seconds), "-vf", scale + ",format=yuv420p",
                "-fpsmax", "30", "-c:v", "libx264", "-profile:v", "high", "-crf", str(crf),
                "-preset", "slow", "-map_metadata", "-1", "-map_chapters", "-1",
                "-movflags", "+faststart"]
        cmd += ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] if args.audio else ["-an"]
        run(cmd + ["-sn", "-dn", str(out)])
        if out.stat().st_size <= VIDEO_MAX or crf >= 36:
            break
        crf += 3
    if out.stat().st_size > VIDEO_MAX:
        sys.exit(f"Clip is still {out.stat().st_size // 1000} KB after compressing. Use a shorter --seconds.")

    # Poster frame: shown before the clip plays and when it can't load.
    from PIL import Image
    frame = tmp / "frame.png"
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(args.poster_at), "-i", str(out),
         "-frames:v", "1", str(frame)])
    img = Image.open(frame)
    poster = tmp / "poster.jpg"
    save_jpeg(img, poster, POSTER_MAX)
    return {"kind": "video", "size": img.size,
            "files": [(out, f"{item_id}.{{h}}.mp4", "src"), (poster, f"{item_id}.{{h}}.jpg", "poster")]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=pathlib.Path)
    ap.add_argument("item_id")
    ap.add_argument("--alt", required=True, help="what the shot shows, for screen readers and when it can't load")
    ap.add_argument("--credit", help="photographer or source, for third-party media")
    ap.add_argument("--credit-url", help="link to the original")
    ap.add_argument("--license", help="e.g. 'CC BY 4.0' or 'Used with permission'")
    ap.add_argument("--audio", action="store_true", help="keep the clip's sound")
    ap.add_argument("--start", type=float, default=0, help="video: start this many seconds in")
    ap.add_argument("--seconds", type=float, default=15, help="video: keep at most this many seconds")
    ap.add_argument("--poster-at", type=float, default=0.5, help="video: poster frame time in the cut clip")
    args = ap.parse_args()

    if not args.source.exists():
        sys.exit(f"{args.source} not found.")
    if args.license and not args.credit:
        sys.exit("--license needs --credit (who the media belongs to).")
    item_path = find_item(args.item_id)
    MEDIA.mkdir(exist_ok=True)

    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        if args.source.suffix.lower() in VIDEO_EXT:
            res = prep_video(args.source, args.item_id, tmp, args)
        else:
            res = prep_photo(args.source, args.item_id, tmp)

        # Remove this item's earlier media, then move the new files in.
        for old in MEDIA.glob(f"{args.item_id}.*"):
            old.unlink()
        media = {"kind": res["kind"]}
        h = short_hash(res["files"][0][0])
        for path, name, field in res["files"]:
            dest = MEDIA / name.format(h=h)
            dest.write_bytes(path.read_bytes())
            media[field] = f"media/{dest.name}"
            print(f"{dest.relative_to(REPO)}  {dest.stat().st_size // 1000} KB")

    w, h_px = res["size"]
    media["width"], media["height"] = w, h_px
    media["alt"] = args.alt
    if args.credit:
        media["credit"] = {k: v for k, v in (("name", args.credit), ("url", args.credit_url),
                                             ("license", args.license)) if v}

    item = json.loads(item_path.read_text())
    item["media"] = media
    item_path.write_text(json.dumps(item, indent=2, ensure_ascii=False) + "\n")
    print(f"{item_path.relative_to(REPO)}: media set ({res['kind']}, {w}x{h_px})")


if __name__ == "__main__":
    main()
