# Changelog

## 0.1.0

First release, for formskills 0.9.0 (Form Extension Contract API 1).

- Trigger Tester dock panel: paste prompts (one per line, `=> skill` for the skill that should win) or load them from a `.txt`, `.md`, `.csv`, `.json` or `.jsonl` file, and rank every skill in scope by an offline BM25 model of its name and description.
- Verdict per prompt: clear, contested (runner-up at 80% or more of the winner), weak (one word under 4.0) or no match, with the matched words and an expected-skill check.
- Overlaps: pairs of skills that contest the same prompts, and pairs whose descriptions read alike (TF-IDF cosine 0.3 or more), with their shared words.
- Never wins: skills that win none of the prompts, where they came closest and the words only they use.
- Try a description: rewrite one skill's description and see each prompt's rank change live; save it to your copy (or your own skill) in one undoable step, then formskills' Check runs on it.
- Scope: all apps, the app chosen in formskills, or your own skills; your copies' descriptions are used when they changed `SKILL.md`.
- Self-test: one prompt per skill from the first sentence of its description.
- Save the report as Markdown or JSON through formskills' own save dialog.
- Headless command `rank` for agents: `formskills cli extensions command trigger-tester rank '{"prompts":[...]}'` answers with the JSON report.
