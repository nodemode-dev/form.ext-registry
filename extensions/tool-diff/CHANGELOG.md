# Changelog

## 0.1.2 (2026-11-07)

- Package `tool-diff-0.1.2.formpkg`, 14926 bytes, SHA-256 `99c7f53ef84d2deec4f95c6bb6843d21c31008b304e45408eec87e8117b87935`. Same panel, commands and `ui/` files as 0.1.1; only the manifest's version changed.
- `package-lock.json` is committed, so `npm ci && npm run build` reproduces `package/ui` byte for byte, as the Form Extension Registry's checks require. The README's build steps use `npm ci`.

## 0.1.1 (2026-11-07)

- Package `tool-diff-0.1.1.formpkg`, 14925 bytes, SHA-256 `bf4d0a4eabff933c6e464535b3cb0fba4794aa1118ef123d3a0df6baf93979d7`. Same panel and commands as 0.1.0.
- `tools/formpkg.py` is the kit's current packager (it refuses a missing `api` and `native: true`).
- The README says how formMCP saves a report: it confirms the name and saves into Downloads.

## 0.1.0 (2026-11-07)

- First release for formMCP 0.9.0 (Form Extension Contract, API 1). Package `tool-diff-0.1.0.formpkg`, 14924 bytes, SHA-256 `32f15ed5a1e302e780070775beec22c54a945288dde05eea2e94071637956325`.
- Snapshot: keeps formMCP's current tool list of a Form app (names, descriptions, read-only marks), up to eight per app in the extension's storage; an unchanged list is not stored twice.
- Load from App: starts the app once through formMCP's `tool_load` so its list is current, with progress and Stop.
- Import: a saved MCP `tools/list` answer (whole JSON-RPC answer, its `result`, or a bare array), a formMCP tool list file, or a Tool Diff report. Imported lists carry argument schemas, so arguments are compared too.
- Compare: added, removed, renamed and changed tools; for arguments, added and removed arguments, type changes and widenings, required and optional, enum values, defaults, limits and nested objects and arrays. Each change is breaking, caution, additive or a note; filters for each kind.
- Save HTML or JSON reports through formMCP's own save.
- Headless commands for agents: Snapshot Every App's Tools, and Check for Tool Changes, which answers with what changed in each app since its last snapshot.
- Follows formMCP's theme (dark and light) from `host.hello` and `ext.theme`, and refreshes when formMCP reports a new tool list.
