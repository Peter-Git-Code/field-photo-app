#!/usr/bin/env python3
"""Check content/ before publishing: every file listed, every link valid,
index metadata in step with each item. Run: python3 tools/check_content.py"""
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
ROOT = REPO / "content"
MEDIA = REPO / "media"
# Size limits for files in media/ (tools/prep_media.py keeps under these).
MEDIA_MAX = {"photo": 500_000, "video": 8_000_000, "poster": 300_000}
BLOCKS = {"p", "h", "list", "note", "tips", "scale", "table", "settings", "kit", "tool", "more", "link"}
TOOLS = {"exposure", "equiv", "dof", "flash", "nd", "timelapse", "stars"}
errors = []


def err(msg):
    errors.append(msg)


index = json.loads((ROOT / "index.json").read_text())
ids = {i["id"] for i in index["items"]}
device_ids = {d["id"] for d in index["devices"]}
listed = {"index.json"}
used_media = set()


def check_media(m, where):
    if not isinstance(m, dict):
        return err(f"{where}: media must be an object")
    kind = m.get("kind")
    if kind not in ("photo", "video"):
        err(f"{where}: media kind must be photo or video, not {kind!r}")
    if not m.get("alt"):
        err(f"{where}: media needs alt text")
    if "credit" in m and not (m["credit"] or {}).get("name"):
        err(f"{where}: media credit needs a name")
    for field, limit in (("src", MEDIA_MAX.get(kind, 0)), ("poster", MEDIA_MAX["poster"])):
        src = m.get(field)
        if not src:
            if field == "src":
                err(f"{where}: media has no src")
            continue
        if not src.startswith("media/"):
            err(f"{where}: media {field} {src!r} must be a file in media/")
            continue
        f = REPO / src
        used_media.add(src)
        if not f.is_file():
            err(f"{where}: media file {src} missing")
        elif f.stat().st_size > limit:
            err(f"{where}: {src} is {f.stat().st_size // 1000} KB, limit {limit // 1000} KB. Run tools/prep_media.py on it.")


def check_blocks(blocks, where):
    for b in blocks:
        t = b.get("t")
        if t not in BLOCKS:
            err(f"{where}: unknown block type {t!r}")
        if t == "link" and b.get("id") not in ids:
            err(f"{where}: link to missing item {b.get('id')!r}")
        if t == "tool" and b.get("tool") not in TOOLS:
            err(f"{where}: unknown tool {b.get('tool')!r}")
        if t == "table":
            n = len(b["head"])
            for r in b["rows"]:
                if len(r) != n:
                    err(f"{where}: table row has {len(r)} cells, header has {n}: {r}")
        if t == "more":
            check_blocks(b.get("blocks", []), where + " > " + b.get("title", "more"))


for meta in index["items"]:
    path = ROOT / meta["file"]
    listed.add(meta["file"])
    if not path.exists():
        err(f"{meta['id']}: file {meta['file']} missing")
        continue
    item = json.loads(path.read_text())
    for key in ("id", "type", "mode", "title", "summary", "appliesTo", "devices", "minutes"):
        if item.get(key) != meta.get(key):
            err(f"{meta['id']}: index {key}={meta.get(key)!r} but file has {item.get(key)!r}")
    if item["type"] not in ("basic", "guide", "lesson"):
        err(f"{meta['id']}: bad type {item['type']}")
    if item["mode"] not in ("photo", "video", "both"):
        err(f"{meta['id']}: bad mode {item['mode']}")
    if item["type"] == "guide" and not item.get("steps"):
        err(f"{meta['id']}: guide has no general steps")
    for dev, d in (item.get("devices") or {}).items():
        if dev not in device_ids:
            err(f"{meta['id']}: unknown device {dev}")
        if d.get("status") not in ("ok", "unavailable", "unchecked"):
            err(f"{meta['id']}: {dev} has bad status {d.get('status')}")
        if d.get("link") and d["link"] not in ids:
            err(f"{meta['id']}: {dev} links to missing item {d['link']}")
        if d.get("status") == "ok" and not d.get("steps"):
            err(f"{meta['id']}: {dev} is ok but has no steps")
    check_blocks(item.get("blocks", []) + item.get("after", []), meta["id"])
    if "media" in item:
        check_media(item["media"], meta["id"])

for m in index.get("manuals", []):
    listed.add(m["file"])
    if m["device"] not in device_ids:
        err(f"manual for unknown device {m['device']}")
    p = ROOT / m["file"]
    if not p.exists():
        err(f"manual file {m['file']} missing")
        continue
    man = json.loads(p.read_text())
    if man.get("status") != m.get("status"):
        err(f"manual {m['device']}: index status {m.get('status')} but file has {man.get('status')}")
    for s in man.get("sections", []):
        check_blocks(s.get("blocks", []), f"manual {m['device']} > {s.get('title')}")
        for gid in s.get("usedIn", []):
            if gid not in ids:
                err(f"manual {m['device']}: usedIn links missing item {gid}")

for f in ROOT.rglob("*.json"):
    rel = f.relative_to(ROOT).as_posix()
    if rel not in listed:
        err(f"{rel} exists but isn't listed in index.json")

if MEDIA.exists():
    for f in MEDIA.iterdir():
        rel = "media/" + f.name
        if f.is_file() and f.name != "README.md" and rel not in used_media:
            err(f"{rel} isn't used by any item. Delete it or add it to an item's media.")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"OK: {len(index['items'])} items, {len(index.get('manuals', []))} manuals, "
      f"{len(used_media)} media files, version {index['version']}")
