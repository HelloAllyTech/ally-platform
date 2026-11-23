# Chunk 07: Long-term memory and feedback

**Read first:** `CONTEXT.md`, `spec.md` §7 (memory recall), §8.

## Goal
The agent improves from what happens to its work: it stops repeating rejected findings, recognises duplicates, follows conventions reviewers taught it, and treats fragile areas with more care.

## Build
1. `memory/store.py`: LangGraph `PostgresStore` in the `bughunter` database. Use pgvector + the `embeddings` model role when the extension is available; otherwise index by error signature, app and file paths. Code must work in both modes (config flag). Namespaces from the spec. Typed records (Pydantic) per namespace; every write passes through the PHI scrubber.
2. `learn` node: at the end of each run, write the bug record (signature, root cause, fix summary, files, status) to `(app, "bugs")`.
3. `memory/feedback.py` (+ CLI `bug-hunter feedback`): read all `bug-hunter` PRs and escalation issues; classify outcome (merged unchanged / merged with edits / closed with reason / closed without reason / stale). Write:
   - rejected findings + reason → `(app, "false_alarms")`;
   - recurring review comments → `(app, "conventions")` (summarised, deduplicated);
   - files with rejected or reverted fixes → `(app, "fragile_areas")`;
   - per-lens and per-source precision → `("global", "run_stats")`.
4. Recall: `triage` checks `false_alarms` and `bugs` (dedupe) first; `fix` gets up to 5 similar past fixes and the app's conventions; `risk_gate` raises risk for `fragile_areas`. Recall goes through `context/builder.py` budgets.
5. Memory hygiene: records have `created_at`, `last_used_at`, `source_run`; `bug-hunter memory list|show|delete` so a human can inspect and remove bad memories.

## Done when
- Tests: a rejected finding stops the same finding at triage next time; a duplicate signal is closed as duplicate; scrubber runs on every write.
- Eval: replay the golden set twice with feedback from the first pass simulated; report false-alarm rate before/after in the notes.
- `CHUNK-07-NOTES.md` written.

## Not in this chunk
Scheduling the feedback job (chunk 08).
