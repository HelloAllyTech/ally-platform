# Adding a prompt

The one recipe for adding a prompt to ally-be, ally-ai or ally-ai-learn. Each service has its own section; the rules before them apply to all three.

## How prompts work, in five lines

- **The Skills Store (ally-be) is the source of truth.** Every service runs a prompt's *live version* from the store. Editing a `.txt` file in Git changes nothing that runs once the prompt exists.
- **A file in Git is a prompt's seed.** It creates the prompt on its first deploy (its first live version and stored default), and it is the last-resort fallback inside ally-ai and ally-ai-learn if a request arrives without the store's text. After that it never overwrites anything: an existing prompt's stored default, which Revert restores, is its production text. Keep the file a working base, not the tuned production text (the repo is public). A base keeps everything the code depends on: every placeholder, any section markers or output shape the code parses, and the few lines that make the prompt do its job. It leaves out the tuning. A fresh clone runs on these files (ally-be's first sync seeds a local store from them), so a base must still work end to end. Nothing blocks a fuller default; it's a convention reviewers hold.
- **Each prompt has a contract in code:** its code, the variables the code supplies (`required` or `optional`), how the code reads the answer, and how it shows up in the Skills Store (name, description, category). Sync sends it to the store, which refuses a version that drops a required variable.
- **Adding a prompt is two files per prompt:** the `.txt` default and its contract. There are no `.meta.json` sidecars and no lists to register in.
- **Changing a prompt's text later** is a new version in the Skills Store, or `node scripts/prompts/prompts.mjs push` from the CLI. See [prompts-api.md](./prompts-api.md).

## Rules for every service

<!-- docs-path-lint: ignore -->
**Name the file for what it does.** The path becomes the prompt's code: `src/prompts/feedback/tone_rewrite.txt` is `feedback_tone_rewrite` in ally-be; ally-ai and ally-ai-learn prefix theirs with `ally_ai_` and `ally_ai_learn_`. Use `snake_case`, a folder, and a descriptive filename, never `system.txt` or `user.txt`. See the naming rules in [prompts-folder.md](./prompts-folder.md#naming-standards).

**Mark a variable `required` only when both hold:** every call site always supplies a non-empty value, and the prompt is broken without it (the transcript to judge, the text to translate, the target language). Everything else is optional. A wrong `required` stops editors from saving a legitimate version.

**Say how the code reads the answer**, when it parses JSON:

| The code… | Contract | What CI does |
|---|---|---|
| parses free text as JSON (`JSON.parse`, `json.loads` on plain text) | `output: 'json'` / `output_format = "json"` | renders the default and makes one cheap model call to check the answer parses, retried once (`scripts/prompts/check-structured-defaults.mjs`) |
| gets JSON enforced by the provider (`jsonMode: true`, `response_format`, `with_structured_output`) | `output: 'structured'` / `output_format = "structured"` | nothing; the provider guarantees the shape |
| uses the answer as text | leave it out | nothing |

**A model call needs a registry row.** If your code calls a model, add its row to `ally-be/src/llm/constants/ai-task-registry.constants.ts` in the same PR (recipe: [ai-task-registry.md](./ai-task-registry.md)). Point the row's `promptOverride` at your prompt's code so the model chosen in the Skills Store wins.

## ally-be

1. **The default.** Create `src/prompts/<folder>/<name>.txt`. Placeholders are `{{name}}`.

   ```text
   Rewrite the feedback below in a {{tone}} tone. Answer in JSON: {"text": "..."}.

   {{text}}
   ```

   An optional variable renders as empty when the code doesn't supply it, so either write the text to read well without it or have the call site pass a default (as step 3 does with `tone ?? 'neutral'`).

2. **The contract.** Add an export to `src/prompt/contracts/prompt-contracts.ts`. Exporting it is the whole registration; `PROMPT_CONTRACTS` collects every export.

   ```ts
   /** src/prompts/feedback/tone_rewrite.txt */
   export const FEEDBACK_TONE_REWRITE = definePrompt(
     'feedback_tone_rewrite',
     { text: 'required', tone: 'optional' },
     {
       name: 'Feedback tone rewrite',
       description: 'Rewrites a piece of feedback in a requested tone.',
       category: 'Feedback',
       runtimes: ['ally-be'],
       output: 'structured', // jsonMode below; 'json' if you parse plain text
     },
   );
   ```

   Optional fields: `name`, `description` and `category` default to values derived from the path; `runtimes` limits the Skills Store's model picker to models that runtime can run; `defaultModel: { provider, model }` sets the model a *new* prompt starts on. See `PromptDetails` in `src/prompt/contracts/define-prompt.ts`.

3. **The call site.** Load the live text, fill it with `renderPrompt` (its inputs are type-checked against the contract: a missing required variable or a misspelt one is a compile error), and pass the code to the completion so the prompt's model applies.

   ```ts
   import { FEEDBACK_TONE_REWRITE, renderPrompt } from 'src/prompt/contracts';

   const template =
     (await this.promptSharedService.getPromptByCode(FEEDBACK_TONE_REWRITE.code)) ?? '';
   const result = await this.llmCompletion.complete({
     taskId: 'feedback-tone-rewrite',
     task: LlmTask.FEEDBACK_TONE_REWRITE,
     promptCode: FEEDBACK_TONE_REWRITE.code,
     system: renderPrompt(FEEDBACK_TONE_REWRITE, template, { text, tone: tone ?? 'neutral' }),
     prompt: 'Rewrite it now.',
     maxTokens: 800,
     jsonMode: true,
   });
   ```

   Inject `PromptSharedService` (`src/prompt/service/prompt-shared.service`) and `LlmCompletionService` (`src/llm-agent/service/llm-completion.service`), and add `PromptModule` (`src/prompt/prompt.module`) and `LlmAgentModule` (`src/llm-agent/llm-agent.module`) to your module's `imports`. Use `resolvePrompt(code)` instead of `getPromptByCode` when you need the text *and* its model settings from one lookup.

4. **The registry row**, if it calls a model: add a value to `LlmTask` (`src/learn/enum/llm-task.enum.ts`; nothing else needs it) and a row to `src/llm/constants/ai-task-registry.constants.ts`. Copy a neighbouring row with a `tier` (`LlmModelTier.FAST` for cheap calls), and set:
   - `id`: the `taskId` your call site passes (`'feedback-tone-rewrite'`);
   - `promptOverride`: your prompt's code, exactly (`'feedback_tone_rewrite'`);
   - `provider` and `defaultModel`: the **fallback**, i.e. what runs while nobody has picked a model for the prompt in the Skills Store (the tier's vendor and model, e.g. `'openai'` / `'gpt-4o-mini'`), not `'resolved'`. `promptOverride` names where to look for the rest.

5. **Run the checks.**

   ```bash
   npx jest src/prompt/contracts src/llm         # contract coverage + your default satisfies it; registry guards
   npx tsc --noEmit -p tsconfig.json             # renderPrompt's inputs are type-checked here
   npx eslint --fix <the files you changed>      # prettier formatting is enforced by lint
   node ../scripts/prompts/check-prompts.mjs     # repo rules (from ally-be/)
   ```

   On the next start, sync creates the prompt in your local store with its name, description and contract.

## ally-ai

ally-ai runs the live versions ally-be sends in the request body (`prompts`), and falls back to its own file only when a prompt is missing from it. ally-be's `AiService.getPromptOverrides()` sends every `ally_ai_*` prompt, so a call made through it needs no change in ally-be. Two cases do:

- **A new endpoint:** give its request schema a `prompts: Optional[Dict[str, Any]]` field (copy one in `app/schemas/`), and have ally-be pass `getPromptOverrides()` when it calls it.
- **A call made outside `AiService`'s request helpers, or a queue message:** it must include your prompt. Build the map with `AiService.getPromptOverrides(codes)`, scoped to the codes it renders (the transcription queue message carries `TRANSCRIPTION_PIPELINE_PROMPT_CODES`; WhatsApp sends its three knowledge prompts).

**Never send an empty prompt map.** ally-ai runs its own file for any prompt missing from the map, and those files are minimal bases. Read the prompts with `getPromptOverrides` (ally-ai) or `PromptSharedService.getPromptsForRuntime` (ally-ai-learn's session metadata, or any other service):
- A failed store read is retried once.
- If it fails again, the last rows read successfully in this process are served. That is production's text from moments before, so a slow or briefly unreachable database doesn't fail a counsellor's request or a session.
- With nothing cached for the request, it throws, so the call fails visibly instead of running minimal text.

ally-ai's transcription handler does the same for a message queued without prompts: it uses the last pipeline prompts it received when ally-be can't be reached, and requeues the message only when it has none.

1. **The default.** Create `app/prompts/<folder>/<name>.txt`. Placeholders are `{name}` (Python `str.format`), so a literal brace is doubled: `{{"text": "..."}}`.

2. **The contract.** Add a class to `app/prompts/contracts.py`. Declaring it is the whole registration; `PROMPT_CONTRACTS` collects every subclass.

   ```python
   class FeedbackToneRewriteInputs(PromptInputs):
       """`feedback/tone_rewrite.txt`."""

       prompt = PromptInfo(
           code="ally_ai_feedback_tone_rewrite",
           name="Feedback tone rewrite",
           description="Rewrites a piece of feedback in a requested tone.",
       )
       output_format: ClassVar[Optional[str]] = "structured"

       text: str  # no default = required
       tone: Optional[str] = None  # optional
   ```

3. **The call site.** Always pass the request's `prompts`: without them the call silently runs the local default, and `tests/core/test_prompts_render_from_store.py` fails. In `OpenAITextGenerationService`, follow `generate_nudge`: render with the store's text, use the client for the model the Skills Store chose, and label the usage.

   ```python
   template = load_template("feedback/tone_rewrite", prompts=prompts)
   answer = await self._invoke_llm(
       template.format(text=text, tone=tone or "neutral"),
       ToneRewrite,  # the Pydantic answer model: structured output
       task=LLMTask.FEEDBACK_TONE_REWRITE.value,
       llm_override=self._client_for("feedback/tone_rewrite", prompts),
   )
   ```

   Outside that service, `load_and_format(path, prompts=prompts, **variables)` renders and `get_backend_llm_overrides(path, prompts)` returns the `(provider, model, temperature)` the Skills Store chose. Add the usage label to `LLMTask` in `app/core/llm_usage/tasks.py` **and** to ally-be's `LlmTask` (the same string; it is a cross-repo contract), then add the registry row in ally-be (see the rule above).

4. **Run the checks.**

   ```bash
   poetry run pytest tests/core/test_prompt_contracts.py tests/core/test_sync_prompts_contract.py tests/core/test_prompts_render_from_store.py
   make lint
   ```

## ally-ai-learn

ally-ai-learn reads every `ally_ai_learn_*` prompt's live version from the session's room metadata: the `promptData` object, which carries a `prompts` map. A new prompt needs no change in ally-be, but every render must be handed that object, or it silently runs the local default.

1. **The default.** Create `app/prompts/<folder>/<name>.txt`. Placeholders are `{name}`; double a literal brace, as in ally-ai.

2. **The contract.** Add a class to `app/prompts/contracts.py`. `Field(title=...)` is the label the Skills Store shows editors for a variable; agent prompts the Studio wires up also set `prompt_type` and `has_states` on `PromptInfo`.

   ```python
   class EventsToneCheckSystemInputs(PromptInputs):
       """`events/tone_check_system.txt`."""

       prompt = PromptInfo(
           code="ally_ai_learn_events_tone_check_system",
           name="Tone check (system)",
           description="Classifies the tone of a learner's message.",
       )
       output_format: ClassVar[Optional[str]] = "structured"  # only if the code parses the answer

       message: str = Field(title="Learner message")
   ```

3. **The call site.** Render it with the session's prompt data:

   ```python
   from app.prompts.resolver import load_and_format

   system = load_and_format("events/tone_check_system", prompt_data=prompt_data, message=text)
   ```

   Where `prompt_data` comes from:
   - **In a graph node or anything holding the scenario:** `scenario.prompt_data`.
   - **In an event detector:** give the event a `prompt_data: Optional[object] = None` field and have `app/core/events/factory.py` pass `prompt_data=(metadata or {}).get("promptData")` when it creates the event. `BinaryClassifierEvent` and `HelperParaphrasedEvent` show the pattern.

   `tests/unit/test_prompts_render_from_store.py` fails on any render call that doesn't pass it.

   **If it calls a model**, record the usage right after the call, with a label from `LLMTask` in `app/core/llm_usage/tasks.py`:

   ```python
   from app.core.llm_usage.emitter import emit_openai_usage
   from app.core.llm_usage.tasks import LLMTask

   emit_openai_usage(completion, task=LLMTask.TONE_CHECK.value, model=model, provider="openai")
   ```

   Add the same string to ally-be's `LlmTask` (a cross-repo contract), then add the registry row in ally-be (see the rule above). Latency matters on the voice path: keep model calls off the turn's critical path where you can.

4. **Run the checks.**

   ```bash
   poetry run pytest tests/unit/test_prompt_contracts.py tests/unit/test_sync_prompts_contract.py tests/unit/test_prompts_render_from_store.py
   make lint
   ```

## What CI checks

| Check | Fails when |
|---|---|
| Contract tests (each service) | a default has no contract, a contract has no default, a default drops a required variable, or a closed contract's default uses an unknown one |
| Render-from-store guards (ally-ai, ally-ai-learn) | a render call doesn't pass the request's `prompts` / the session's `prompt_data`, so it would ignore the Skills Store |
| `scripts/prompts/check-prompts.mjs` | `.prompts/` is committed, a migration writes prompt text into `prompts_versions`, or an existing default changes without its contract file (or the `prompt-default-refresh` label) |
| `scripts/prompts/check-structured-defaults.mjs` | an `output: 'json'` default no longer makes a model answer in parseable JSON (runs when the `PROMPT_CHECK_OPENAI_KEY` secret is set; locally it skips without `OPENAI_API_KEY`) |
| AI task registry guards (ally-be jest) | a model call has no registry row |

Adding a prompt does not need a doc change: the docs guard watches the prompt conventions (the contract helpers and sync), not each prompt.

## Changing an existing prompt

- **Its text:** a new version in the Skills Store, or `prompts pull` → edit → `prompts push` with the CLI. Never edit the `.txt` to change what runs. See [prompts-api.md](./prompts-api.md).
- **The variables the code supplies:** change the contract and the call site in the same PR. Add a new variable as optional, publish a version that uses it, then make it required, so no live text breaks.
- **Its name or description:** rename it in the Skills Store. The contract's `name` only names a new prompt; its `description` and `category` are rewritten on every deploy.
