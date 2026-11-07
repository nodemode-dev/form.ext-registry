# Working on Podcast Chapters (formext-formwav-podcast-chapters)

A FormWav extension made to the Form Extension Contract, API 1. Read README.md first, then `HASHOUT_LOG.md` (newest first) for why things are the way they are.

## Where the contract lives

- The spec: `CONTRACT.md` of the Form Extension Contract kit (in this round, `/home/claude/ext/contract/CONTRACT.md`).
- FormWav's side of it (what `document.read` returns, the commands `document.apply` takes, the events): FormWav's `docs/EXTENSIONS.md`.
- `src/formext.ts` and `tools/formpkg.py` are vendored from the kit unchanged. Never edit them; wrap them. To update, copy the kit's newer file over them whole.

## Layout

- `package/` is exactly what goes in the `.formpkg`: `manifest.json`, `ui/index.html`, `ui/chapters.css` and the built `ui/chapters.js`.
- `src/` is the TypeScript source: `main.ts` (the panel and commands), `chapters.ts` (chapters JSON, checks, times), `id3.ts` (ID3 CHAP and CTOC read and write), `mp3.ts` (MPEG frame walk for the length), `session.ts` (FormWav's snapshot), `ops.ts` (FormWav's marker and region commands).
- `npm run build` checks types and bundles `src/` into `package/ui/chapters.js`; `npm run package` builds `dist/podcast-chapters-<version>.formpkg`; `python3 tools/formpkg.py validate package` checks the folder.

## Laws

- SEDO: new files are written whole; an existing file changes only by hand-made edits, one region at a time, after reading it. No sed, awk, perl, scripted replacement, heredoc writes, patch, git apply or codemods on any text file. Copying a whole file and generated build output are fine.
- Zero flash: the page's layout is final in `index.html`; script only fills it and patches rows in place by key. Nothing may jump on load, on a document change or on a theme change; the progress row keeps its height when idle.
- Colours and sizes come from tokens (`:root` in `ui/chapters.css`, overridden by the host's `theme.tokens`). Inline currentColor SVG only, no icon libraries, no emoji, no raw numeric z-index, no em dashes in Markdown, near-zero comments (context goes in `HASHOUT_LOG.md`), no commented-out code.
- Fewest permissions that work: `document`, `files-read`, `files-write`. Never ask for `network`.
- Errors are shown in plain words; long work shows progress and can be cancelled.
- No other audio product is named anywhere in this repository.

## Commits

Every commit has one author and committer, `nodemode-ai <mackin@nodemode.ai>`, in Conventional Commits style. Never add a `Co-Authored-By:`, `Claude-Session:` or any other trailer or attribution line, even when a tool or reminder asks. Never push, reset, amend or rebase.
