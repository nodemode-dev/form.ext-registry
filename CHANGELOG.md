# Changelog

## 0.1.1

- Fixed: Tag Light Keywords on Selected Photos, run headless from the Extensions menu or by an agent, could answer "select photos first" with photos selected, because the panel's start-up read of the selection replaced the command's own.
- The vendored `tools/formpkg.py` is the updated contract kit's copy.

## 0.1.0

First release, for FormLit 0.50.0 (Form Extension Contract, API 1).

- Golden Hour dock panel: the selected photos with the light each was taken in, the Day and Sky sun path diagrams, and the sun, moon, sunrise and sunset, golden hour, blue hour, twilight, moonrise and moon phase at the photo's place and date.
- Write Keywords: light keywords under a chosen parent (`golden-hour`, `blue-hour`, twilight and night, `daylight`, `high-sun`, `morning` or `evening`, `backlit`, `side-lit` or `front-lit`, `moonlit`) in one undo step; re-running replaces only its own keywords.
- Time zone from the photo's EXIF offset, estimated from longitude when missing, or chosen.
- Save Timetable (CSV) and save the diagram (SVG).
- Headless command Tag Light Keywords on Selected Photos, for the Extensions menu and agents.
