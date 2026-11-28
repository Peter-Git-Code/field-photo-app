# Field Photo

An offline photography guide for the phone: quick-reference basics, step-by-step
how-to guides, short lessons, per-device manuals and field calculators. It
installs from the browser (no app store) and keeps working without signal.

## Use it

Open the site once with signal, then install it:

- **iPhone:** Safari › Share › Add to Home Screen
- **Android:** Chrome menu › Install app

Install it rather than bookmarking it. iOS can clear a plain browser tab's
offline data after a few weeks without use.

## How it works

| Part | Where |
|---|---|
| App shell (HTML, CSS, JS) | `index.html`, `app.css`, `app.js` |
| Offline caching | `sw.js` |
| Content library | `content/` (JSON) listed in `content/index.json` |
| Sample photos and clips | `media/`, prepared with `tools/prep_media.py` |
| Diagrams | `content/figures/*.svg`, our own drawings, shown inline so they follow the theme |
| Content checks | `tools/check_content.py` |

No build step and no backend. Each person's kit, ticked steps and theme are
saved on their own phone only.

On first launch, and whenever `content/index.json` has a new `version`, the
app downloads every content file so the whole library is offline. **About ›
Check for updates** does the same on demand.

## Content types

- **Basics** (`content/basics/`): one-screen reference tables and scales.
- **How-to guides** (`content/guides/`): settings card, kit, general steps, tips,
  plus optional device-specific steps under `devices`.
- **Lessons** (`content/lessons/`): a condensed card with expandable "more" sections.
- **Manuals** (`content/manuals/`): per-device quick reference.

### Device steps in a guide

```json
"appliesTo": ["camera"],
"devices": {
  "canon-r10": { "status": "ok", "steps": ["…"], "note": "…" },
  "dji-lito-x1": { "status": "unavailable", "note": "No interval timer. Use …" }
}
```

`status` is `ok` (device steps written), `unavailable` (the device can't do it,
with a workaround in `note`) or `unchecked` (general steps shown, optional
`note`). A device with no entry whose type isn't in `appliesTo` is shown as
unavailable automatically. Device types: `camera`, `drone`, `action`, `flash`, `phone`. Keep the
`devices` and `appliesTo` fields in `content/index.json` in step with the item
file; the checker enforces it.

### Blocks

`p`, `h`, `list`, `note` (`tone`: ok/warn/no), `tips`, `scale`, `table`,
`settings`, `kit`, `tool` (exposure/nd/timelapse/stars), `link` (another item's
id), `more` (collapsible, holds blocks). Text supports `**bold**` only.

### Sample photos and clips

A guide or lesson can show one photo or short clip at the top. Never commit
camera originals: run them through the prep script, which shrinks them,
strips metadata (GPS, serial numbers) and writes the item's `media` field.

```bash
python3 tools/prep_media.py ~/DCIM/IMG_0412.JPG milky-way --alt "Milky Way over the ridge"
python3 tools/prep_media.py DJI_0031.MP4 slow-motion --alt "Wave breaking, 4x slower" --start 2 --seconds 8
```

| | Photo | Clip |
|---|---|---|
| Size | longest side 1600 px | longest side 1280 px (720p), max 30 fps |
| Format | JPEG, about 150–450 KB | H.264 MP4, no sound unless `--audio`, cut to `--seconds` (default 15) |
| Limit (checker) | 500 KB | 8 MB, poster frame 300 KB |

Third-party media is allowed with credit and permission: add
`--credit "Name" --credit-url URL --license "CC BY 4.0"` (or `"Used with permission"`).
The credit is shown under the shot. Only use media whose licence allows it,
and keep proof of permission for anything that isn't openly licensed.

```json
"media": { "kind": "video", "src": "media/slow-motion.bd06e0.mp4", "poster": "media/slow-motion.bd06e0.jpg",
           "width": 1280, "height": 720, "alt": "…", "credit": { "name": "…", "url": "…", "license": "…" } }
```

Media isn't part of the offline download. Each file is saved on the phone the
first time it's shown with signal; until then the page shows a placeholder.

### Diagrams

Diagrams are our own SVG drawings in `content/figures/`, used with a `figure` block:
`{"t": "figure", "src": "figures/histogram.svg", "alt": "…", "caption": "…"}`.
They're put into the page inline, so colour them with the classes in `app.css`
(`t`, `m`, `a`, `st`, `sa`…) and they follow Day, Dark and Night. Fixed colours
(sky, Moon) take class `hue`, which Night turns red. Unlike media, diagrams are
part of the offline download. Never copy diagrams from paid guides: redraw them.

## Publishing a change

1. Edit or add files in `content/`, and run new photos and clips through `tools/prep_media.py`.
2. Run `python3 tools/sync_index.py` to rebuild the item and manual lists in `content/index.json`.
3. Bump `version` in `content/index.json` and add a line to `changes`.
4. If you changed `index.html`, `app.css`, `app.js` or the icons, bump
   `SHELL_VERSION` in `sw.js` and `APP_VERSION` in `app.js` to match. Open phones
   reload themselves once the new version is installed.
5. Run `python3 tools/check_content.py`. It also checks media paths, sizes, alt text and credits, and flags unused files in `media/`.
6. Push to `main`. GitHub Pages redeploys; phones pick it up on their next launch with signal.

## Sources

Content is written in our own words. Where a page is based on someone else's
guide, it names and links the original. Third-party photos and clips are used
only with a licence or permission that allows it, and every one is credited
in its item's `media.credit`. Text, tables and infographics from other guides
are still rewritten, not copied.
