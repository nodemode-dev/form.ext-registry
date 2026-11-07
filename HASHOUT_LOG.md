# HASHOUT LOG

## v0.1.1

Headless race, found by the formlit integrator: a headless Tag Light Keywords started its own `load()` while the page's start-up `load()` (after `host.hello`) was still due, and the newer run superseded the command's, so the command saw an empty selection and answered "select photos first" (seen from the menu and from the MCP `extension_command`, depending on timing). The start-up is now the `booted` promise; the command waits for it, loads, then waits while any newer load (a `selection.changed` reload) is still busy before writing.

`tools/formpkg.py` copied again from the updated kit (it now requires `api` "1" and refuses native packages); the package was valid under both.

## v0.1.0

Why Golden Hour: FormLit has GPS, a Map module, keywords and capture times, but nothing that says what the light was. The only "golden hour" and "blue hour" strings in the app are preset names; there is no sun, moon, twilight or azimuth code in the engine, the interface, the command catalogue or the MCP tools. The Palette candidate was set aside: Golden Hour is pure maths with no image decoding in the sandbox, and it uses FormLit's location data, which the app collects but does little with.

Astronomy: low-precision solar coordinates (mean anomaly and longitude, equation of centre to the second harmonic) and a truncated lunar theory (one term each in longitude, latitude and distance), sidereal time from the standard linear formula. Accurate to about a minute for sunrise and sunset and to a fraction of a degree for the moon, which is ample for light classes several degrees wide. Checked against published times: London 2026-06-21 sunrise 03:43 UTC and sunset 20:21 UTC, Sydney 2026-12-21 05:40 AEDT, New York 2026-03-20 06:59 and 19:08 EDT, the midnight sun at Tromso, the full moon of 2026-11-24 and the new moon of 2026-11-09.

Day events are found by sampling the local day every 5 minutes and bisecting each crossing to under a second, not by closed-form hour angles: the same code then handles polar day and night, and spans that start before midnight or run past it ("until 02:56", "from 22:35"). Day results are cached per day and rounded place.

Light classes use the sun's geometric altitude: below -18 night, -18 to -12 astronomical twilight, -12 to -6 nautical, -6 to -4 blue hour, -4 to +6 golden hour, +6 to +50 daylight, above +50 high sun. Sunrise and sunset use -0.833 (refraction and the sun's radius). Morning or evening comes from whether the sun is climbing. Light direction needs the photo's GPS image direction: within 50 degrees of the sun's bearing is backlit, more than 130 is front-lit, otherwise side-lit, and only while the sun is above -4. Moonlit needs the sun below -6, the moon up and at least a quarter lit.

Time zone: FormLit's snapshot gives the camera's local time and the EXIF offset separately. With no offset the zone is estimated as the nearest whole hour of longitude and labelled as estimated; the person can choose an offset that then applies to every photo.

Keywords: one `document.apply` per Write, so the whole change is one undo step. Ops are grouped per keyword (one `photo.addKeywords` per keyword with all its ids), so the op count stays small for large selections. Re-running removes only this extension's own leaf paths under the chosen parent that no longer apply; other keywords are never touched. With an empty parent the leaves are written at the top level.

Selection comes from `document.read({ what: "selection" })`, one call for up to 500 photos; analysis yields to the event loop every 25 photos so Cancel and the progress line stay live. `selection.changed` and `document.changed` reload after 250 ms, except while a write is in flight.

Zero flash: every row of the panel (status line, list box of fixed height, chart with a fixed aspect ratio, facts with fixed rows, preview of fixed height) is in the HTML; script only fills text and the chart. The Cancel link keeps its space when hidden (`visibility`). Measured layout shift in the harness: 0.

Theme: the panel reads FormLit's own token names (`--surface-1`, `--text-primary`, `--line-1`, `--cta-bg` and so on) and falls back to the contract's minimum set (`--panel`, `--text`, `--border`) and then to Studio Dark values, so it looks right whichever set the host sends. Sky band colours are the extension's own tokens with a light-mode set.

Saved diagrams resolve the CSS variables to colours first, so the SVG file stands alone.
