# Focus Timer for FormTray

A focus timer that lives on FormTray's Widgets board, beside the Form apps you work in. Run a focus session, take a short break, and after every fourth session a long one. Write a few words about what you are working on, and see today's minutes and a chart of the last seven days against a daily goal. When a session ends FormTray shows a toast, and an optional chime plays.

![Focus Timer as a large Widgets tile in the dark theme, a focus session running, with a week of sessions in the chart](docs/screenshot.png)

## What it does

- **Focus and breaks.** 25 minute focus sessions, 5 minute short breaks and a 15 minute long break after every 4 focus sessions by default. Each length, the long-break rhythm and the daily goal can be changed in Settings.
- **One click.** Click the ring or Start to begin; click again to pause and resume. Reset starts the session over, Skip moves to the next one.
- **A note.** "What are you working on?" is saved with each focus session.
- **Today and this week.** The large tile shows today's focus minutes and finished sessions and seven bars for the last seven days, with the goal as a dashed line. Click a bar to see that day's sessions with their times and notes. A session stopped early after a minute or more is listed as "Stopped at N min" and still counts toward the day's minutes.
- **When a session ends.** A FormTray toast says what comes next, and a chime plays if it is on. "Start the next session on its own" chains sessions without a click.
- **It keeps time when closed.** Sessions are worked out from the clock, so reloading the tile, resizing it or restarting FormTray does not lose time. A session that ended while the tile was closed is logged at its real end, and the toast says when it ended.
- **Three sizes.** Small shows the ring and the time (click it to start or pause), medium adds the phase, Start and Skip, large adds the note, Reset, Settings and the chart. The tile title shows the minutes left while a session runs.
- **Commands.** From FormTray's Extensions menu, the Apps view search or `formtray-cli extension_command focus-timer <command>`: `toggle` (Start or Pause), `skip` (Skip to Next Session) and `today` (Show Today's Sessions). Each answers with the phase, status, seconds left and today's minutes.

## Install

1. Open FormPortal, go to Extensions and find **Focus Timer** for FormTray (or open the `.formpkg` file with FormPortal to sideload it).
2. In FormTray, open the tray menu's **Extensions** submenu, choose **Extensions Panel** and press **Open** on Focus Timer. The tile appears on the Widgets board.
3. Resize, move or remove the tile like any other in the board's Edit mode.

FormTray needs version 0.15.0 or later.

## Permissions

None. Focus Timer uses only what every extension gets: its own storage (for settings, the running session and up to 60 days of log), toasts and its tile title. It does not read or change your board, open files or reach the network, so FormTray shows no permission card.

## Build

```sh
npm install
npm run build     # type-check and bundle src/ into package/ui/focus.js
npm run package   # dist/focus-timer-0.1.0.formpkg, with its SHA-256 and size
python3 tools/formpkg.py validate package
```

To run it from this folder while you work on it, list `package/` in `extensions/formtray/dev.json` under FormPortal's folder (form.ext's Run in App does this), and FormTray loads it with the source Development.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE.md`.
