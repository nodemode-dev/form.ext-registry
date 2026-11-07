# Golden Hour for FormLit

Golden Hour tells you what the light was doing when each photo was taken. Select geotagged photos in FormLit and it works out, for the place and time of each one:

- where the sun and the moon were (height and compass bearing), the moon's phase and how much of it was lit;
- sunrise, sunset and solar noon; the morning and evening golden hour and blue hour; civil, nautical and astronomical dawn and dusk; moonrise and moonset;
- what kind of light the photo was taken in: night, astronomical or nautical twilight, blue hour, golden hour, daylight or high sun, and whether it was morning or evening.

It draws the day's sun path two ways: **Day**, the sun's and moon's height through the day over the light bands with the capture moment marked, and **Sky**, a view of the sky from above with the sun's track, the golden hour stretch highlighted, the moon, and the camera's heading when the photo records one.

Then **Write Keywords** tags the photos, in one undo step, with keywords under a parent you choose (`Light` by default): `golden-hour`, `blue-hour`, `nautical-twilight`, `astronomical-twilight`, `night`, `daylight`, `high-sun`, plus `morning` or `evening`, `backlit`, `side-lit` or `front-lit` (from the camera's compass heading), and `moonlit`. Running it again replaces its own earlier light keywords and leaves every other keyword alone. **Save Timetable** saves a CSV of all of it, and the download button saves the diagram as SVG.

Everything is computed in the panel from published astronomy formulas. Nothing leaves your computer.

![Golden Hour in FormLit's dock, Sky view](docs/screenshot.png)

## Time zones

FormLit stores the camera's local time and, when the file has it, the EXIF time offset. Golden Hour uses that offset. When a photo has none, it estimates the zone from the longitude and says so on the Time zone line; pick the right offset in the Time zone field when the estimate is wrong (daylight saving time, or a zone far from its meridian).

## Commands

The Extensions menu has:

- **Golden Hour: Show Sun and Moon for Selected Photos** opens the panel.
- **Golden Hour: Tag Light Keywords on Selected Photos** runs without the panel, with the options you last chose, and reports what it tagged. Agents reach it through FormLit's `extension_command` MCP tool (`id: golden-hour`, `command: tag-selected`).

## Install

Open FormPortal, find Golden Hour under FormLit's extensions and install it; FormLit picks it up within two seconds (or use Extensions, Reload Extensions). To install a file you built yourself, add the `.formpkg` in FormPortal as a sideloaded extension. The first time the panel opens, FormLit asks you to allow what it needs.

To run it from this folder while developing, point FormLit at `package/` with a `dev.json` under FormPortal's root (form.ext's Run in App writes it):

```json
{ "format": "formext-dev-extensions", "format_version": 1, "product": "formlit",
  "extensions": [ { "id": "golden-hour", "path": "/path/to/formext-formlit-golden-hour/package", "added": "2026-11-07T10:00:00Z" } ] }
```

## Permissions

| Permission | Why |
|---|---|
| `document` | Read the selected photos (file name, capture time, offset, location, compass heading, keywords) and add or remove the light keywords. |
| `files-write` | Save Timetable (CSV) and save the diagram (SVG) where you choose. |

It asks for no network access and no file reading.

## Build

```sh
npm install
npm run build      # type-check, bundle src/ into package/ui/
npm run package    # python3 tools/formpkg.py build package -o dist
python3 tools/formpkg.py validate package
```

Needs Node 20 or newer and Python 3. FormLit 0.50.0 or newer.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE.md`.
