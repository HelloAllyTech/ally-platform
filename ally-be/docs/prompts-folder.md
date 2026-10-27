# Prompts folder (src/prompts)

Prompt default files (`.txt`) in `src/prompts/` are synced to the Skills Store on startup. This doc covers naming, structure and the folder conventions. **To add a prompt, follow [adding-a-prompt.md](./adding-a-prompt.md)** — the one recipe for all three services.

## Naming Standards

**File and path names must be descriptive.** They drive the prompt's display name and description in the Dashboard. Generic names (e.g. `system`, `text`, `user`) produce confusing labels.

### Rules

| Rule                                   | Example                                           | Avoid                                                         |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Use `snake_case`                       | `code_mixed_system.txt`                           | `system.txt`                                                  |
| Filename must describe purpose         | `general_text_translation.txt`                    | `text.txt`                                                    |
| Minimum: subdir + descriptive filename | `openai_translation/speech_reexpression_user.txt` | `openai_translation/user.txt` <!-- docs-path-lint: ignore --> |
| Combine generic terms with context     | `translation_system_prompt.txt`                   | `system.txt`                                                  |

### Why

- The path `subdir/filename` becomes `promptCode` = `subdir_filename` (e.g. `openai_translation_code_mixed_system`)
- Display names are derived from `promptCode` via `formatLabel`
- Generic filenames like `system`, `text`, `user` yield unclear names in the UI

## Structure

```
src/prompts/
├── openai_simulation/
│   ├── character_profile_text.txt
│   ├── challenge_description.txt
│   └── ...
├── openai_translation/
│   ├── code_mixed_system.txt
│   ├── speech_reexpression_user.txt
│   └── ...
├── builder/
│   └── interviewer_system.txt
└── product_updates/
    └── consolidate.txt
```

Each `.txt` has one contract in `src/prompt/contracts/prompt-contracts.ts`: its variables, how the
code reads the answer, and its Skills Store name, description and category. There are no
sidecar files.

### Agent system prompts

A folder like `builder/` (or `character_interview/`, `course_copilot/`) holds the _system_
prompt for a long-running agent rather than a one-shot generation. Two things differ:

- It is read by code through `PromptSharedService.getPromptByCode('<folder>_<file>')`, not
  picked by a human in the Admin Dashboard — so the contract's name and description are for
  whoever later goes looking for it, not for a chooser.
- Load it with `loadPromptTemplate` (`src/common/util/prompt-template.util.ts`), not a
  hardcoded copy of the text. `getPromptByCode` already falls back to the shipped `.txt`
  when the store has no row; `loadPromptTemplate` also uses that shipped default when the
  database can't be read, so the agent keeps working, and throws only when the prompt has
  no text anywhere — the caller's failure path runs instead of a model call with no
  instructions.

### Builder's one-shot prompts (`builder/`, `agent_memory/`)

Beside the two agent prompts (`interviewer_system`, `platform_rules`), `builder/` holds the
system prompts of Builder's one-shot calls: the PRD reviewer and its recheck, the discovery
planner, the replay eval's simulated admin and judge, the correction classifier, the milestone
planner, the research pass, the outcome categoriser, the lesson curator, the past-build ranker
and note writer, and the interview summariser. `agent_memory/curator_system.txt` is the
notebook curator's. These were compiled constants until they moved here; sync seeded the store
with that text, and each `.txt` is now a minimal working base like every other default: it keeps
the JSON shape, enum values, operation grammar (AGREE / EDIT / ADD / REMOVE) and tool names the
code parses, and `src/builder/constants/test/builder-system-prompts.spec.ts` checks it does.

They load through `loadPromptTemplate` (`src/common/util/prompt-template.util.ts`): the
store's live text, else, when the database can't be read, the shipped `.txt` trimmed as sync
stores it — never an empty prompt; with no text anywhere it throws into the call's own failure
path. A call that names a configured model (`builder.mechanicalModel`, `plannerModel`) uses
`promptModelOr`, so a model picked on the prompt in the Skills Store wins. The PRD reviewer's
section keys and finding cap are rendered in as `{{sectionKeys}}` / `{{maxFindings}}` from the
constants its parser uses, so the two cannot drift. The eval's admin and judge read their live
text directly, never a candidate's overrides: they are the measuring instrument.

### Copilot field prompts (`agent_builder/`)

`agent_builder/` is a one-shot folder with an extra naming contract: each file's **basename
must equal a value of the `AgentBuilderField` enum**, because the wizard names a field and
the server derives the prompt code from it (`toPromptCode('agent_builder', field)`). Renaming
one of these files renames the API's field value; adding a file does nothing until the enum
knows about it.

Three of them — `opening_statements`, `linguistic_style_samples`, `allowed_filler_words` — are
**language-scoped**: they are fired once per language the actor brief says the client speaks,
and get `{{languageName}}` / `{{languageCode}}` on top of the shared variables. Write them to
produce native content for that language rather than a translation of the English set. Since
`renderTemplate` leaves an unknown `{{placeholder}}` empty, a language-scoped prompt should
still read sensibly if the language variables are absent — a dashboard-overridden copy
predating them keeps working.

Two more are about the language set rather than a form field. `spoken_languages.txt` is handed
the studio's language catalog in `{{availableLanguages}}` and answers with ids from it, which
is what the fan-out iterates. `language_voices.txt` then casts one voice per language from
`{{voiceCandidates}}` against `{{personaGender}}` / `{{personaAge}}`, filling the mandatory
Language–Voice mapping. Both are **id-returning prompts**, and that is where they bite:

- Print the id the answer must use in a form the model won't paraphrase, and say so in the
  output rule. An earlier `language_voices` candidate block headed each group
  `Language 4 — Hindi:` and gpt-5-mini duly answered `{"Language 4": …}`, which a strict
  lookup read as "picked nothing".
- Validate every returned id against the list you offered, per group. A voice id that is real
  but belongs to another language would dispatch the wrong TTS for the whole session, so
  `parseLanguageVoices` checks membership rather than existence.

### Event field prompts (`event_builder/`)

`event_builder/` follows the same basename-is-the-enum-value contract as `agent_builder/`,
against `EventBuilderField` and `toPromptCode('event_builder', field)`. It turns an author's
free-text description of a counsellor behaviour into the configuration of a
`BINARY_CLASSIFIER` session event, one file per part: `classifier`, `examples`, `feedback`,
`branch_instruction`, `tags`.

`classifier.txt` is sequenced ahead of the rest and its answer is fed back in as
`{{className}}`, so the examples and feedback describe the class the author actually kept
rather than one each call re-imagined. The other four must still read sensibly when
`{{className}}` renders empty — `renderTemplate` blanks unknown placeholders, and a caller
that fires them all in parallel gets a weaker answer, not a broken one.

Two constraints specific to this folder:

- **`examples.txt` is a runtime cost, not just a generation.** What it writes is inlined into
  a prompt ally-ai-learn rebuilds on _every learner turn_, batched across every classifier on
  the simulation. `{{numExamples}}` is clamped server-side to `MAX_EXAMPLES_PER_POLARITY`;
  do not write a prompt that argues for more.
- **Negatives must be near misses.** A negative example only calibrates the boundary if it is
  something a counsellor plausibly says in the same moment that a careless classifier would
  wrongly flag. Unrelated negatives read fine in review and teach the classifier nothing.

`branch_instruction.txt` is the one file here that returns **plain text, not JSON** — it is
injected into the AI client's prompt as direction to an actor — so it is the only field the
service calls with `expectJson: false`.

### Agent prompts coupled to a tool contract (`character_interview/`)

`character_interview/interviewer_system.txt` is an agent prompt (above) with one extra
hazard: the shape it tells the model to produce is also validated in code, in
`CharacterInterviewToolsService`. The two are one contract in two files, and only one of
them is deployable.

That asymmetry decides how to change it. Because the prompt row may be
**dashboard-overridden in production**, a deployed prompt can still be asking for the
previous shape long after the validator moved on — so when the contract changes, the
validator has to accept the old shape as well as the new one. When characters went
per-language (`voices` / `languageCharacteristics` / `linguisticStyleSamples` keyed by
`languages.id`), `executeSaveCharacterDraft` kept coercing a flat string or array, filing
it under the language its named voice implies. Rejecting it instead would strand an admin
mid-interview over a contract change they cannot see or fix.

The same reasoning applies to what a tool _returns_: `get_voices` reports each voice's
`languageId` precisely so the prompt never has to infer the key it files a voice under.
If a prompt has to derive an id, expect it to guess wrong.

**A tool the deployed prompt has never heard of must be harmless.** `search_corpus` was added
to the tool belt in the same change as the grounding guidance that tells the model when to use
it — but production serves the prompt's live version in the Skills Store, so only the tool
ships with the deploy. An unused tool is inert, which is why this is safe; the reverse is not.
Guidance that reaches the model without the tool existing would produce calls to a tool that
isn't there. **Add the tool first, then publish the guidance as a new version in the Skills
Store.**

### Course Copilot (`course_copilot/`)

One agent prompt and eleven one-shot specialist prompts, all under the "Course Copilot" category
(see [`course-copilot.md`](./course-copilot.md)):

- `interviewer_system.txt` is the agent system prompt (above): read through
  `getPromptByCode('course_copilot_interviewer_system')`, cached for a minute, with a hardcoded
  fallback, and **set the interview model on this row** — its provider/model win over
  `COURSE_COPILOT_MODEL`. The platform rules (limits, item types) are appended in code, not
  written here, because the tools enforce them.
- The specialists (`blueprint_planner`, `article_writer`, `quiz_writer`, `journal_writer`,
  `annotation_writer`, `course_meta`, `course_reviewer`, `image_prompt`, `roleplay_brief`,
  `history_summary`, `landing_page_writer`, `ally_notes_writer`) are templates with `{{variables}}` rendered by `renderTemplate`, called in
  JSON mode. Unlike the agent prompt they **throw** when the row is missing — a course built
  from a fallback prompt would be quietly worse rather than visibly broken.
- `landing_page_writer` is the one specialist that runs outside a session: the builder's Landing
  page tab calls it (`POST /v1/course-copilot/tracks/:trackId/landing-page-draft`) against the
  _saved_ course and the model's answer is never stored — the builder fills only empty fields.
  Its output is `TrackLandingPage` minus `version`, `persona.imageUrl` and `persona.characterId`,
  and `normaliseLandingPageDraft` enforces the limits, the known section ids, the single hard
  call and the no-exclamation-marks rule in code. The prompt's writing rules (the hook opens on a
  person and an extraordinary moment; exactly three replies, each labelled for the learner's move
  and never scoring the client's outcome; teasers that never reveal a roleplay's hidden events or
  a quiz answer) are the product's design rules, so change them deliberately.
- `ally_notes_writer` also runs outside a session (`POST /v1/course-copilot/tracks/:trackId/ally-notes-draft`):
  it drafts the course's notes for the Ally guide and per-item tension overrides from the saved
  outline. It is never shown an answer key, and its draft is checked against the course's correct
  answers in code (one repair pass) — the same check that blocks saving notes that leak one.
- Like `character_interview/`, each specialist's output shape is **also validated in code**
  (`src/course-copilot/service/specialists/*` normalise ids and shapes, then run the track
  validator). The same rule applies: the live text is in the Skills Store and changes on its own
  schedule, so a changed output shape needs the normaliser to accept the old one too.

### Defaults in Git, live text in the Skills Store

The Skills Store is the source of truth for prompt text: every runtime serves a prompt's
**live version**. A `.txt` in this folder is the prompt's **default**:

- it **creates** the prompt the first time it deploys (live as version 1);
- it is the **fallback** a service uses if the store can't be reached;
- it seeds the prompt's stored default only when the prompt is created; an existing prompt's stored default is its production text from the Skills Store cutover, and that is what **Revert** puts back live;
- it is the open-source default for anyone running Ally without our store.

After the first deploy, **editing the `.txt` changes nothing in production** — sync never
touches an existing prompt's live text. Change a prompt by saving and publishing a new version
in the Skills Store, or with the `prompts` CLI (`scripts/prompts/prompts.mjs`, see
[prompts-api.md](./prompts-api.md)). CI (`scripts/prompts/check-prompts.mjs`) fails a PR that
edits an existing default without changing its contract, unless it carries the
`prompt-default-refresh` label.

### Contracts: the variables the code supplies

Each prompt's contract is declared **in code**, next to the code that fills it:
`src/prompt/contracts/prompt-contracts.ts` here (`definePrompt`), and
`app/prompts/contracts.py` in ally-ai and ally-ai-learn (one Pydantic model per prompt). How to
write one: [adding-a-prompt.md](./adding-a-prompt.md). A
variable is `required` when the code always supplies it and the text depends on it; anything
else is optional. Contracts start **open** (undeclared variables allowed); close one once its
list is complete and the store refuses unknown variables too.

A contract's `output` says how the code reads the answer: `'json'` when it parses free text as
JSON (CI's structured-default check makes one cheap model call to confirm the default still
answers in JSON; a `_system`/`_user` pair is sent as one call), `'structured'` when the provider
enforces the shape (`jsonMode`, `response_format`, `with_structured_output`), so the text needn't.

From the contract: the call site's inputs are type-checked (`renderPrompt`); sync sends the contract to the store,
which refuses a version that drops a required variable; each service's test suite checks its
defaults satisfy their contracts; and the release check
(`scripts/prompts/release-check.mjs`) checks production's live text against the new code's
contracts before a deploy. When a code change needs a new variable, add it as optional,
publish a version that uses it, then make it required — so no live text ever breaks.

**Since 2026-10-21 the prompt editor cannot change Builder's prompts directly.**
`builder_interviewer_system` and `builder_platform_rules` are gated by Builder's replay eval
(`src/builder/constants/builder-eval-gate.constants.ts`): `PUT /prompts/:id` and the revert
refuse any new version of their text or model settings with a 409. A change goes
to `POST /v1/builder/eval/prompt-candidates` instead, which replays the eval fixtures with the
candidate, compares against the live settings, and publishes it through the same update path
only if nothing got measurably worse. Renaming or re-describing them still works. How the
eval works: [`docs/builder-eval.md`](builder-eval.md).

**`ok:false` means "repair and retry" — so never use it for an honest negative.** The model
obliges an `ok:false`, which is right for a validation failure and wrong for a retrieval that
found nothing: it becomes a rephrase loop against a corpus that genuinely lacks the material.
`search_corpus` returns `ok:true` with an empty list and an explicit note. It reserves
`ok:false` for retrieval being _unreachable_, and says so in those words, because an agent that
cannot tell "the library has nothing" from "the library could not be read" will tell an admin
their corpus is empty when it is not.

**Do not forbid the retry — that is the agentic half of agentic RAG.** The first version of the
grounding guidance said "do not rephrase and retry more than once", written to prevent a loop.
It prevented the recovery instead. Single-shot cosine similarity is brittle across paraphrase:
in production, one indexed document answered "guidance on writing good speech samples" and
returned nothing at all for "how specific should a character be, and why is a generic one bad?"
— against a section titled "Specific beats representative, every time". The guidance now asks
for ONE more search at a different ANGLE (a different level of abstraction or vocabulary, not a
reword of the same sentence), capped at two, and tells the agent explicitly that IT judges
relevance rather than the score.

The same finding moved the similarity floor down rather than up, and the reasoning is worth
keeping because the intuitive version is wrong. A high floor looks like a safety measure for an
agent that cannot decline — but this agent can, and does: it reads the passage and the prompt
tells it to report finding nothing rather than invent. A high floor does not make grounding
safer, it removes the agent's judgement by never showing it the passage. Precision belongs to
the agent, recall to retrieval.

**Say what to search FOR, in the agent's own terms.** Left to itself the interview agent asked
subject-matter questions ("common speech-related changes in early dementia") while the corpus
held craft guidance ("what makes a speech sample useful"), so good material went unfound. The
guidance now names both kinds and when each applies: craft before you WRITE something, subject
before you ASK about something.

**Normalise keys and unwrap values; do not assume one call is self-consistent.** A production
`save_character_draft` keyed `voices` and `languageCharacteristics` by numeric id and
`linguisticStyleSamples` by locale (`"en-IN"`) — in the same call — and wrapped each sample as
`{ "sample": "…" }` instead of a plain string. Stating the shape in the prompt is necessary and
not sufficient; the validator resolves locales and bare codes to `languages.id` and pulls a
string out of `{sample|text|value|utterance|line}`.

A wrong key is worse than a rejected one. Storing `{"en-IN": [...]}` succeeds, and then nothing
renders it, because every language-keyed form field looks up by numeric id — the failure is a
silently empty tab, reported as a saved draft. Prefer normalising to a shape the reader can find
over accepting whatever arrived.

### Code-read one-shot prompts

A third shape sits between the two: a folder like `analytics_suggestions/`, `ux_signals/`,
`bug_hunter/` or `product_updates/` holds the system prompt for a **single** call that a feature
makes on demand or on a schedule, read through `getPromptByCode` like an agent prompt but not
driving a conversation. `bug_hunter/classify_repo.txt`, `bug_hunter/classify_miss.txt`, `bug_hunter/decide.txt` and `bug_hunter/review_study.txt` (a second model reads a fix session's study of the feature, including who else reads the value it changes, before any code changes) are the
plainest examples: one JSON answer each, and code validates the answer against a closed catalogue
(dispatchable repos; miss reasons and senses; for `decide.txt`'s D1 the sense menu is per repo, so
`locale_parity` is only offered where locale files exist; its D5–D7 answers for the orchestrator
are checked against the move menu the same way, and a veto or a fixed point never asks the model
at all) before anything is stored, so a model that invents a value is discarded rather than
trusted. `product_updates/consolidate.txt` is the one whose output reaches a public page
(app.helloally.ai/blog/changelog) with no human step, so its reply is validated field by field
and code enforces what the prompt asks — public text carrying jargon is capped at low confidence so
the team digest flags it — rather than trusting the model to comply. Since 2026-10-01 public is the
default audience, staff-tool work included; internal is kept for work of no value to anyone, and a
wrong call is corrected from the admin console's audience toggle.

`skill_experiment/` (`judge.txt`, `designer.txt`, `challenger_generator.txt`) is the same shape: the judge, the prompt
designer and the challenger generator behind auto-improve ([skill-experiments.md](skill-experiments.md)). Their payload — a rubric
and an output to score, or a champion and its scores to revise — arrives as a separate JSON message,
so neither file has placeholders.

These deliberately do **not** degrade to a hardcoded fallback — they throw when the row is
missing. The reasoning is the opposite of the agent case: an agent answering slightly worse
still serves its user, whereas one of these produces a batch of stored items (roadmap
suggestions, bug findings) that a human will later act on believing a reviewed prompt
produced them. Silently falling back would put unattributable rows in a review queue, so
failing the run is the safer answer. Follow whichever pattern matches what your prompt's
output becomes, not whichever folder you copied.

### Stateless conversational prompts

A fourth shape looks like an agent prompt but keeps no session: `roadmap/opportunity_copilot.txt`
drives a multi-turn interview with research tools, yet each turn is independent, with the whole
transcript (and the previous turn's working brief) rendered into one user message. Within a
turn it is a real tool loop — research tool calls and their results are appended in order —
but nothing survives the turn except what the client sends back, so there is no history to
rebuild across turns and no `tool_use` blocks left unpaired — the trap `rebuildAnthropicHistory`
(Builder) and `rebuildHistory` (Character) exist for.

Five rules matter when writing one:

- **Speaker-label the transcript** you render in (`ADMIN:` / `YOU:`). Without it the model
  cannot tell its own previous questions from the answers and starts re-asking them.
- **If the prompt grades anything that later gates a write, grade the write's own criteria** —
  the same constant, the same ids. `opportunity_copilot.txt` reports on
  `ROADMAP_READINESS_CRITERIA` because its draft is filed with a signed readiness token, and a
  prompt marking its own private rubric would be a signature over a check nobody ran. If you
  edit the criteria, the interview follows automatically; if you edit the prompt to grade
  something else, you have broken the gate rather than the interview.
- **Return the structured turn through a tool the prompt requires last** (`submit_turn`), not
  through JSON mode. JSON mode on Anthropic is a forced `tool_choice`, which current Claude
  models reject, and it cannot coexist with research tools in the same call.
- **A research tool the model has no index for goes unused.** The copilot had GitHub tools for
  a week and called none of them, because nothing told it what existed to look up. It started
  using them once the service put a product map in the cached system prefix
  (`BuilderProductMapService`: repos, admin surfaces, knowledge-pack heads, the wiki and
  repo-docs index). Ship the index with the tool, and say in the tool description how its
  search actually matches — GitHub code search ANDs every word, so the model's natural
  eight-word queries all came back empty until the description said "one to three words".
- **Keep worked examples away from the cases you test with.** A prompt example that resembles
  the conversation gets copied nearly verbatim, finding and recommendation included. Set
  examples in a different feature area from the one being discussed, so the model borrows
  the shape and not the content.

Prompts that a _runner_ fetches over HTTP mid-run (Builder's build protocol) are not in this
folder at all — they are TypeScript builders under `src/<domain>/constants/`, because they are
assembled per run from live state rather than being static text.

## Display name, description and model (in the contract)

What used to live in `_meta/*.meta.json` sidecars is part of the contract now (`PromptDetails` in
`src/prompt/contracts/define-prompt.ts`): `name`, `description`, `category`, `runtimes`, and
`defaultModel: { provider, model }`. Without them, sync derives the name, description and
category from the path (via `formatLabel`).

- **When sync runs** (app startup or `POST /api/v1/prompts/sync`) it writes `description`,
  `category` and `runtimes` on every deploy, and `name` only when it creates the prompt: a rename
  in the Skills Store is an admin's choice and stays.
- **`defaultModel`** sets the model a prompt **starts on** when sync creates it — e.g.
  `product_updates_consolidate` starts on `openai` / `gpt-5`, because its output is public copy
  and the reasoning-tier default wrote too much jargon in side-by-side runs. Sync never applies it
  to a prompt that already exists: from then on the model belongs to the prompt's versions in the
  Skills Store. Prefer this to naming a model at the call site — the prompt is the layer the AI
  Tasks screen reads, so the screen keeps showing what actually runs. The registry row's
  `provider`/`defaultModel` still describe the tier fallback, which the completion service retries
  on if the prompt's model fails.

## Adding a New Prompt

See [adding-a-prompt.md](./adding-a-prompt.md): the default, the contract, the call site, the
registry row and the checks to run, for ally-be, ally-ai and ally-ai-learn.

## See also

- [Prompts API (dashboard & sync)](./prompts-api.md) — How the dashboard and other services use the prompt API.
