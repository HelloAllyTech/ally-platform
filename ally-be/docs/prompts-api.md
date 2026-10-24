# Prompts API (Skills Store)

The Skills Store (ally-be's `prompts` tables, edited in the admin dashboard's
**Skills Store**) is the **single source of truth for prompt text**. Every
runtime — ally-be, ally-ai, ally-ai-learn — serves each prompt's **live
version**. Git holds only each prompt's **default** (see
[Prompts folder](./prompts-folder.md)) and its **contract** (the variables the
code supplies, declared in code: `src/prompt/contracts/` here,
`app/prompts/contracts.py` in ally-ai and ally-ai-learn).

## Lifecycle of a prompt

1. **New prompt:** add its default `.txt` and its contract in the same PR. On
   deploy, sync sees a code the store doesn't have and creates it, with the
   default live as version 1.
2. **Every change after that** is a new **version** in the store: from the
   Skills Store editor, or from a laptop with the `prompts` CLI
   (`scripts/prompts/prompts.mjs`). A new version is a **draft** (candidate):
   it is translated, can be tested, and serves nothing until it is
   **published** (promoted).
3. **Sync never changes an existing prompt's live text.** It refreshes only
   what Git owns: the default text (`defaultPrompt`: the fallback when the
   store is unreachable and the Revert baseline), file metadata, and the
   contract. Editing a default file changes nothing in production.

Versions are immutable. A version carries the English text **and** its model
settings (`provider`, `model`, `temperature`); the row mirrors the live
version's settings for readers.

## The one write path

Every writer — editor, CLI, skill experiment Apply, Builder's eval publish,
Revert — goes through `PromptVersioningService`:

- **Create a version** with the newest version number you started from
  (`baseVersion`, drafts included). The prompt row is locked
  (`SELECT … FOR UPDATE`); if anything newer exists the write is refused with
  `409` `errorCode: SKILLS_STORE_STALE_BASE` (`details: {latestVersion,
  currentVersion}`). A version that breaks the prompt's contract is refused
  with `422` `SKILLS_STORE_CONTRACT_VIOLATION` (`details: {missing, unknown}`).
  Translations of the draft start in the background.
- **Publish (promote)** with the live version you saw
  (`expectedCurrentVersion`). Refused with `409 SKILLS_STORE_STALE_BASE` if it
  moved, and `409 SKILLS_STORE_TRANSLATIONS_PENDING` while any translation of
  the draft is still running. A **failed** translation does not block: the
  result lists it in `failedLanguages`, that language keeps serving English,
  and it is retried from the editor. Judge rubrics need
  `confirmJudgeRubricChange` (`409 SKILLS_STORE_JUDGE_RUBRIC_PINNED`): a
  judge's results are labelled by a version pinned in code, so bump it in the
  same change. Putting an earlier version live again needs `rollback: true`.
- **Retention** never deletes the live version or any draft; it keeps the 20
  published versions below the live one. Sessions record each version's
  content hash, so the text that ran stays identifiable.

## API overview

Base path: **`/api/v1/prompts`** (admin session) and **`/api/v1/skills-store`**
(the CLI, with a Skills Store key).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/prompts` | Bearer (VIEW_PROMPT) | List prompts; `.prompt` is the live text. |
| GET | `/prompts/by-codes?codes=a,b` | x-api-key | Live text by codes. |
| POST | `/prompts` | Bearer (EDIT_PROMPT) | Create prompts; each text goes live as version 1. |
| POST | `/prompts/sync` | x-api-key | Sync defaults + contracts from a service's prompt folder. Creates new prompts; never touches an existing prompt's live text. |
| GET | `/prompts/by-type/:promptType` | Bearer (VIEW_PROMPT) | Variants of one `promptType` for the studio pickers (see below). |
| PUT | `/prompts/:id` | Bearer (EDIT_PROMPT) | **Metadata only**: name, description, category, visibility, translation opt-in. Text, model settings or code that differ from live → `400 SKILLS_STORE_USE_VERSIONS`. |
| GET | `/prompts/:id/versions` | Bearer (VIEW_PROMPT) | Versions newest first: `live`, `candidate` (with translation readiness) and `history`. |
| POST | `/prompts/:id/versions` | Bearer (EDIT_PROMPT) | Save text + settings as a draft: `{prompt, baseVersion, provider?, model?, temperature?, note?}`. |
| POST | `/prompts/:id/versions/:version/promote` | Bearer (EDIT_PROMPT) | Publish: `{expectedCurrentVersion, rollback?, confirmJudgeRubricChange?}` → `{version, previousVersion, failedLanguages}`. |
| POST | `/prompts/:id/versions/:version/translations` | Bearer (EDIT_PROMPT) | (Re)translate a version, retrying failed languages. |
| GET | `/prompts/:id/translations?version=N` | Bearer (VIEW_PROMPT) | A version's translations (default: live). |
| POST | `/prompts/:id/revert` | Bearer (EDIT_PROMPT) | Put the Git default live as a new version, translations included. |
| GET | `/prompts/:id/usage` | Bearer (VIEW_PROMPT) | Scenarios referencing this prompt. |
| GET | `/skills-store/export?codes=&candidates=true` | Skills Store key (pull) | Live (and newest/draft) versions with ready translations: what `prompts pull` reads. |
| GET | `/skills-store/prompts/:code` | Skills Store key (pull) | One prompt's versions. |
| POST | `/skills-store/prompts/:code/versions` | Skills Store key (push) | `prompts push`: create a draft (same rules as the editor). Never publishes. |
| POST | `/skills-store/import` | x-api-key, **local only** | Load an export into this store and serve it. Refused unless `SKILLS_STORE_IMPORT_ENABLED=true`, which only local stacks set. |
| GET/POST/DELETE | `/skills-store/keys[/:id]` | Bearer (EDIT_PROMPT) | List, generate (key shown once) and revoke Skills Store keys. |

## Skills Store keys

Anyone with Skills Store access generates a key in **Skills Store → Keys**,
with the `pull` and/or `push` scope, and can share it (contractors included)
and revoke it. Only a sha256 of the key is stored. The CLI sends it as
`x-skills-store-key`. No key can publish: publishing happens in the Skills
Store.

## Working on prompts from a laptop

```bash
# Production's live prompts into the gitignored working copy (.prompts/),
# loaded into the local stack so local tests run on exactly that text:
SKILLS_STORE_PROD_KEY=ssk_… node scripts/prompts/prompts.mjs pull --remote prod --into-local
# edit .prompts/<service>/<code>.txt, then serve your edit locally:
node scripts/prompts/prompts.mjs apply-local <code>
node scripts/prompts/prompts.mjs status --remote prod
node scripts/prompts/prompts.mjs diff <code> --remote prod
# propose it: a draft in production, published from the Skills Store
node scripts/prompts/prompts.mjs push <code> --remote prod --note "why"
```

A push from a stale copy is refused; `prompts pull <code>` merges your edit
three-way onto the newest version, then push again. `.prompts/` is gitignored
and CI fails a PR that commits it.

## Resolving prompt content at runtime

`PromptSharedService.resolvePrompt(code)` returns the live text **and** its
model settings from one lookup, plus its version and content hash
(`getPromptByCode` returns just the text). The default text is served only
when a row has no live version, and the file on disk only for a prompt the
store has never seen. ally-ai-learn sessions receive every prompt in room
metadata with `version` and `contentHash`, and the session records exactly
that map as `metadata.promptVersions` / `promptHashes` (plus the translation's
hash when one was served).

## Studio visibility (`visibleInStudio`)

A per-prompt switch, edited in the admin's prompt side panel ("Studio availability"), that
controls whether the studio's variant pickers **offer** this prompt:

- `main_agent` variants → the Skill Version dropdown on Create/Edit Simulation.
- `transcript_evaluator` variants → the evaluator dropdown on the report section.

It is a **future-visibility switch, not a capability toggle**, and the distinction is the whole
design:

- **No runtime path reads it.** A scenario carries its choice in
  `metadata.selectedMainPromptCode` / `metadata.selectedEvaluatorPromptCode`; session start
  resolves that code directly. Hiding a variant therefore cannot affect a roleplay already using
  it — it keeps running on the same prompt, with the same version and translations.
- **`by-type` still returns hidden rows.** Most readers of that list resolve an
  *already-selected* code to its name, states and `availableVariables`. Filtering server-side
  would make a hidden-but-in-use variant unresolvable and degrade the editor for exactly the
  scenarios hiding is meant to leave alone. Only the two pickers that offer a choice filter, and
  each keeps the variant its own form is currently on, labelled `(hidden)`, so saving can never
  silently reassign a simulation to a different skill.
- **`DEFAULT true`, no backfill, and `POST /sync` never writes it.** Existing prompts stay
  visible, new duplicates start visible, and a redeploy can't un-hide an admin's decision.
- **Distinct from `isObsolete`,** which is owned by the file-sync lifecycle (the `.txt`
  disappeared) and gates deletion. Hiding a variant must not make it deletable.

There is deliberately no guard against hiding the default variant or hiding every variant: with
nothing on offer the picker says so, leaves the field unset, and the runtime falls back to the
default `main_agent` prompt. `GET /:id/usage` backs the panel's "N simulations already using it
keep running on it" line — the switch warns, it never blocks.

## See also

- [Skills Store design](./skills-store-design.md) — why the store is the single source of truth, the decisions, and how it was built

- [Prompts folder (naming, structure, meta JSON)](./prompts-folder.md)
