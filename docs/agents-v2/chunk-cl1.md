# Chunk CL1 — Cleanup before launch

> Brief for Claude Code. Read `CONTEXT.md`, `v2-chunks.md`, every `CHUNK-*-NOTES.md` (especially the "now unused" lists), then this file.
> Branch: the Slice 1 branch. Tag commits `[CL1]`. Repos: all three.
> **Ends the POC:** … → 20d-2 → **CL1** → launch checklist.

## Why

A lot was built quickly. Before pilots and before Stage 2, the code and docs should be easy for a person to read: nothing dead, nothing duplicated, nothing that describes how things used to work. This pass removes bloat **without changing behaviour**.

## Rules

1. **No behaviour change.** Every suite, every eval (Sunrise suite, 13 fixture sites, conversation evals) and every screenshot baseline passes unchanged.
2. **Nothing removed on a guess.** Each removal has a reason recorded in the report: flagged by a tool, no callers by grep, or a test proving it isn't reached.
3. **Keep the v1 engine and its fallback.** They're removed later in CL2, after 4 weeks of real traffic with 0 fallbacks to v1.
4. **No database columns or tables dropped.** List unused ones in the report for a later migration.
5. **One commit per area** (per app and per kind of removal), so any one is easy to revert.

## Scope

### 1. Dead code

- TypeScript (ally-be, ally-web): run `knip` (or `ts-prune`) for unused exports, files and dependencies.
- Python (ally-ai): run `vulture` (with a whitelist for framework entry points) and check unused dependencies.
- Confirm each finding by grep and tests before removing. Remove unused dependencies from package files.

### 2. Leftovers replaced by new work

- Old setup form helpers and their routes.
- Components replaced by 20d and 20d-2 (from the "now unused" lists in their notes).
- The old Bot page tab and its duplicate logo and colour fields in the UI (the data stays; see rule 4).
- The classic view (`?view=classic`), **only if Shehbaz has signed off**; otherwise leave it and say so.
- The old Conversations list and unanswered list, now replaced by 11a and Q2a.

### 3. Old-agent references that aren't used

- Prompts and seed prompts nothing loads.
- Feature flags that are always on or always off everywhere: remove the flag and keep the live branch.
- Shadow-mode code paths, if no bot uses shadow mode (check production config with Shehbaz first; list it if unsure).
- Comments, docstrings and docs that describe old behaviour.

### 4. Readability

- Files over ~400 lines that mix concerns: split by responsibility.
- Names that don't say what a thing does: rename (with all references).
- Comments: keep the ones that explain *why*; remove ones that repeat the code.
- Consistent error messages and log lines (no personal data in logs, as always).

### 5. Docs

- `docs/agents-v2/README.md`: a short index: what each doc is for, the current stage, where to start. <!-- docs-path-lint: planned -->
- Finished chunk briefs move to `docs/agents-v2/archive/` (notes stay where they are).
- Remove duplicated explanations; each topic has one source of truth that others link to.
- `CONTEXT.md` and `v2-chunks.md` reflect the code as it is after CL1.

## Report (`CHUNK-CL1-NOTES.md`)

- What was removed, by area, with the reason for each group.
- Lines of code before and after, per app.
- Dependencies removed.
- What was kept on purpose and why (v1, anything unsure).
- Unused database columns and tables, for a later migration.
- Proof: suite results, eval results and screenshot baselines unchanged.

## Done when

- [ ] Tools report no unused exports, files or dependencies (or each remaining one is justified)
- [ ] No leftovers from the old setup form, old Bot page tab or replaced components
- [ ] No unused prompts, always-on or always-off flags, or comments describing old behaviour
- [ ] `docs/agents-v2/README.md` exists; finished briefs are archived <!-- docs-path-lint: planned -->
- [ ] Every suite, eval and screenshot baseline passes unchanged
