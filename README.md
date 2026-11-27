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

## Publishing a change

1. Edit or add files in `content/`.
2. Run `python3 tools/sync_index.py` to rebuild the item and manual lists in `content/index.json`.
3. Bump `version` in `content/index.json` and add a line to `changes`.
4. If you changed `index.html`, `app.css`, `app.js` or the icons, bump
   `SHELL_VERSION` in `sw.js`.
5. Run `python3 tools/check_content.py`.
6. Push to `main`. GitHub Pages redeploys; phones pick it up on their next launch with signal.

## Sources

Content is written in our own words. Where a page is based on someone else's
guide, it names and links the original. No third-party photos or infographics
are copied into this repository.
