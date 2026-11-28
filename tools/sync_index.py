#!/usr/bin/env python3
"""Rebuild the item and manual lists in content/index.json from the files in
content/. Keeps version, devices and changes as they are.
Run after adding or editing content: python3 tools/sync_index.py"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "content"
ORDER = {"basics": 2, "guides": 0, "lessons": 1}
META = ("id", "type", "mode", "topic", "title", "summary", "tags", "minutes", "appliesTo", "devices")

index_path = ROOT / "index.json"
index = json.loads(index_path.read_text())
old_order = {i["id"]: n for n, i in enumerate(index.get("items", []))}

items = []
for folder in ("guides", "lessons", "basics"):
    for f in sorted((ROOT / folder).glob("*.json")):
        it = json.loads(f.read_text())
        meta = {k: it[k] for k in META if k in it}
        meta["file"] = f"{folder}/{f.name}"
        items.append(meta)
# Keep the existing order; new items go to the end of their group.
items.sort(key=lambda m: (ORDER[m["file"].split("/")[0]], old_order.get(m["id"], 10_000)))
index["items"] = items

manuals = []
for f in sorted((ROOT / "manuals").glob("*.json")):
    m = json.loads(f.read_text())
    entry = {"device": m["device"], "status": m["status"], "file": f"manuals/{f.name}"}
    if m.get("summary"):
        entry["summary"] = m["summary"]
    manuals.append(entry)
index["manuals"] = manuals

index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
print(f"index.json: {len(items)} items, {len(manuals)} manuals, version {index['version']}")
