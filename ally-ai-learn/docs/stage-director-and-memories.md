# Plan: the Stage Director and state-gated memories

**Status:** Built 2026-10-30, not released (see §9 for what was tested)
**Scope:** `ally-ai-learn` (runtime, prompts), `ally-be` (migration on switch, bulk script), `ally-web` (simulation
editor, monologue panel), Skills Store (two new prompts)
**Replaces, from [`character-model-design.md`](character-model-design.md):** the compile step, `{character}`/`{mind}`, the
memory spec and the pre-reply recall bank. That doc's prod evidence (§1.1) still stands and is the baseline here.

## 1. Why

Sim testers reported six problems. Traced in prod (read-only) on 2026-10-29 and 2026-10-30:

| Reported | Session | Cause | Fixed by |
|---|---|---|---|
| Repeats the same statement | 688069dc | Learner's "Okay." cuts the client mid-reply; the fresh reply to "Okay." goes back to an old line | Barge-in track (§6) |
| Asks the same question again | SS-4710 | Working memory never closes a topic; the same backstory line is recalled every turn | Stage Director (§4) |
| Answers an older question | 688069dc | Same "Okay." interruption | Barge-in track (§6) |
| Invents a detail, then contradicts it | 11db4c34 | "Unmarried" lived only in a Knowledge Source retrieval didn't surface; the ledger then stored "my children are young" | Memories (§3) + Stage Director (§4) |
| Discloses too early | 688069dc | "Okay." interruption; the next reply moved to the next question | Barge-in track (§6) |
| "Let me think" interims | SS-4694 | The updater writes the interim before the learner's question exists, with rules that forbid content. 33% of working-memory interims are "think" lines vs 11% elsewhere | Delivery change (§4.5) |

Read transcripts in `startSeconds` order. Rows are written late, so `createdAt` order shows replies before
the questions they answer.

## 2. Decisions

- **New prompts, opted into per scenario.** Two new Skills Store prompts: a new main prompt and the Stage
  Director prompt (codes chosen when they are created). Selecting the new main prompt for a scenario turns on
  both the director and memories without retrieval. Every scenario on #1, #2, #3, #4, a copy, or no prompt
  keeps today's behaviour exactly, including the updater, working memory and retrieval.
- **No fixes to #3 or the updater.** Prompt fixes there won't help much; improvements go only into the new
  prompts. The old system is frozen until no scenario uses it, then deleted (§4.7).
- **The new main prompt becomes the default for new scenarios once it has been tested** (§7), not on day one.
  Until then new simulations start on #3, as they do since admin-v1.107.0.
- **Selecting the new prompt is the switch** (§3.4). The first time, an agent maps the scenario's memories to
  states. Each prompt keeps its own version of the fields that differ, so switching between #3 and the new
  prompt in either direction loses nothing. A script later switches the remaining scenarios through the same
  path.
- **The simulation editor follows the selected prompt** (§3.3): memories under states for the new prompt, the
  current Knowledge Sources editor for #3.
- **Knowledge Sources become Memories.** No retrieval on the new prompt. Every unlocked memory is in the prompt
  every turn. Backstory plus all memories is about 1.6k tokens at p90 (106 #3 scenarios: 100 have Knowledge
  Sources, average 5, p50 1.6k chars). No keyword search or reranker, even as a fallback (§3.3).
- **A memory is picked under any number of states, or none.** Picked: unlocks once the session has been in ANY
  of those states and stays unlocked (sticky, so a score dropping back never hides it again). The author picks
  each state under that state in the States editor; nothing is implied about the states above or below. None
  picked: available from the first turn.
  The backstory is always shown. Earlier states' memories stay visible.
- **The Stage Director replaces the updater on the new prompt.** One `thoughts` paragraph instead of seven
  `working_memory_*` sections. It never decides which memories are visible; it only says what is on the
  client's mind, including what is already settled.
- **No code between the director and the main prompt.** The paragraph goes into `{thoughts}` as written.
  The only code left in that path: state filtering of memories (a product rule, already exists) and running
  the director after each reply, keeping its last thought on a miss.
- **Version 1 is minimal.** Same inputs, model, timing and budget as today's updater; it says what today's
  sections say, as prose, with no new rules or code checks. That alone removes the causes the director exists
  to fix (no never-closing topics, no copied-word lists, no ledger of invented facts).
- **Improve by prompt iteration, judged by scores** (§5), not by adding code.
- **Ankita owns the director prompt after version 1.** Improving it needs no engineering: the prompt and its
  variables in the Skills Store with tooltips, Live Preview with the monologue panel to read each turn's
  thought beside its reply, the §5 scores to compare versions, and Skills Store history to revert one.

Memories and the director turn on together for a scenario, so the comparison that matters is the same
scenario before and after its switch.

Stacks guidance behind these: *Design APIs to do the right thing automatically* (selecting the prompt does the
migration; nobody runs a separate step); *Information Reveals Trigger Emotion Like Direct Changes* (when a
secret comes out is part of the exercise, so it is controlled through states rather than left to retrieval);
*Validate Prompt and Tool Changes Through Multiple Testing Stages* (tested on a sample before the bulk switch,
and every director prompt version scored before it is published).

## 3. Memories

### 3.1 Data

The new prompt's memories are a new field on scenario metadata, `memories`, with the same shape as
`knowledgeSources` plus a list of states: `{id, title, content, unlocksInStateIds?}`. #3 keeps reading
`knowledgeSources`, untouched (§3.4). ally-be carries `memories` through the scenario DTOs and room metadata the
way it carries `knowledgeSources` today. `KnowledgeUnlockTracker` (`app/core/graph/knowledge_locks.py`) records
every state the session has been in, and a memory unlocks when any of its states is among them. A memory saved
with only the older single `unlocksFromStateId` keeps that field's meaning (that state or any later one); the
editor rewrites it as that state and every later one on load, and the mapping agent writes "from this stage on"
the same way, so the author sees it under each state and can untick any.

### 3.2 Runtime (ally-ai-learn, new main prompt only)

- Skip the title picker (`retrieve_relevant_knowledge` in `app/core/graph/knowledge_retrieval.py`) and render
  every memory in `memories` that has unlocked so far, in authored order. Other prompts keep the
  picker until no scenario uses them.
- The memory block goes in the static part of the system prompt, not after the conversation
  (`RETRIEVED_CONTEXT_DEFER_TO_SUFFIX`). It only changes when the state does, so it stays cached.
- Heading and rule, rendered by code once, as fixed text:
  "Things from your own life. Answer from these when asked. Don't bring them up just to fill a reply."
- Locked memories render as titles only, with a rule, so a question about one gets a deflection instead of an
  invented answer that the memory contradicts once it unlocks:
  "Things you aren't ready to talk about yet: {titles}. If they ask, deflect, say you'd rather not get into
  it, or give as little as possible. Never make something up about it."
  This is how #3's "What has not come up yet" works today. Titles must not give the secret away
  ("my father", not "father's drinking"); the editor help text says so.
- No lag. Today the picker runs every 2 turns in the background and other turns reuse its last pick, so
  content can be up to 2 turns behind. With every unlocked memory on every turn, nothing is out of date; a
  memory changes only when the state does, the same moment the state guidelines change.

Retrieval stays on the old prompts because there it is the only thing holding memories back: most #1 scenarios
have no states, and their Knowledge Sources include "Suicidal thoughts" and "The sleeping pills" (Sayli, 204)
and "Coping strategies & self harm" (Zoya, 101). Removing it there would put that on screen from turn one.

### 3.3 Editor (ally-web admin)

The edit-simulation screen follows the selected main prompt, the same way it already shows or hides fields by
the placeholders a prompt uses (`useIsPlaceholderUsed`). Switching the dropdown switches the screen.

On the new main prompt:

- "Memories": a list like `OpeningDialoguesPanel.tsx`, one row per memory, title + text, replacing the
  `KnowledgeSource.tsx` tabs.
- Memories assigned under each state in `StatesEditor.tsx` ("Memories that unlock here"). Unassigned memories
  show as "Available from the start".
- No retrieval controls and no working-memory fields.
- Help text: the backstory says who the person is; memories are events and things to reveal.

On #3 and the other old prompts: today's editor, unchanged (Knowledge Sources with "Unlocks at").
- Size warning: when backstory plus memories passes 3× today's largest scenario (7.1k chars, so about 21k),
  warn the author that it is getting long. A warning, not a block. It replaces any retrieval fallback: a
  fallback brings back the lag and the missing-fact inventions this removes, doubles what has to be tested, and
  relevance already lives in the director's thought.
- The character library (`CharacterKnowledgeSourcesField.tsx`) gets the same rename.

### 3.4 Migration on switch

**Two versions of the fields that differ, one of everything else.** The memories (titles, text and state
mapping) are kept separately for #3 and for the new prompt. #3's stay where they are today
(`knowledgeSources`), untouched; the new prompt's live in their own field (`memories`, §3.1). Every other field
(Role instruction, identity, backstory, states and their guidelines, opening statements) is shared: an edit
made on either prompt shows on both. Keeping the mapping out of `knowledgeSources` matters because #3's
retrieval honours `unlocksFromStateId`, so writing it there would change #3.

**First switch to the new prompt.** When an author picks the new prompt in the dropdown and the scenario has no
new-prompt memories yet, the editor calls `POST /api/v1/learn/scenarios/memories/map` with the form's current
Knowledge Sources, states, backstory and role, and fills Memories with the answer
(`StageDirectorMemoriesService.mapMemories` in ally-be, prompt `stage_director_memory_mapping`). It reads the
states (names and guidelines) and assigns each memory to the state where the client is ready to share it.
Identity facts stay unassigned, locks an author already set carry over, and with fewer than two states nothing
is assigned. Nothing is written until the author saves. If the call fails, the Knowledge Sources are copied over
as they are. It runs only on an author's own pick, never on loading a scenario.

**After that, the author edits freely.** The editor shows the agent's mapping, and the author can change it:
move a memory to another state, rewrite one, add or remove one.

**Switching back and forth loses nothing.**

- Back to #3: the scenario runs on #3 with its own Knowledge Sources, exactly as before the switch.
  The new prompt's memories, including the author's edits, are kept.
- To the new prompt again: its memories come back as last saved. The agent does not run again.

**Drafts:** switching lands on the scenario's draft, so testing in Live Preview never touches what learners
see. Check that Live Preview runs the draft before relying on this.
**#1 scenarios come later.** Most have no states, or have counsellor-coaching text as state guidance, so
switching them means the agent also writes states with client-facing guidelines (the step that stalled in
August). #1 reads its per-state text from a separate store (`scenario_behavior_instructions`), so writing the
new prompt's states doesn't change #1, and switching back keeps working. Verify that before relying on it.
Supported once the #3 path is proven.

**Bulk switch.** `POST /api/v1/learn/scenarios/stage-director/bulk-switch` (super-duper admins only) runs the
same `mapMemories` for every scenario on #3 (or the `scenarioIds` given) and saves it with the new prompt.
`dryRun` is the default and writes nothing. It skips scenarios with fewer than two states unless
`onlyWithStates` is false, and keeps memories a scenario already has, so a tested mapping is never redone. Its
response lists each scenario's outcome and memories with the state they unlock at; a bad one is fixed by editing
the mapping, or by switching that scenario back to #3.

## 4. The Stage Director

### 4.1 Inputs (director prompt variables)

Every variable the main agent prompt can use is available to the director, and the prompt's author chooses
which to use. Contracts are open and unused variables are ignored, so offering all of them costs nothing;
most values are already computed for the main agent on the same turn. On top of that set:

- **Helpful and unhelpful behaviours:** how the learner's recent turns were labelled (already detected per
  learner turn, and already in the monologue payload). The most useful input for how the client reacts.
- **Its own previous thought.**
- **Titles of locked memories,** never their content, so the client can be reluctant without knowing the
  content ("there's something about my father I'm not ready to get into").

`{thoughts}` itself is not offered, since it is the director's own output for the turn.

Version 1 uses what today's updater reads: recent turns, the current state and the full state ladder with
guidelines, the Role instruction and identity, the backstory, the unlocked memories, the rolling summary, the
previous thought and `{language_label}`.

### 4.2 Output

Plain text: one paragraph, nothing else. No JSON, no fields, no ids. First person, present tense, in the
session's language, about 60–120 words to start. Code stores it and puts it into `{thoughts}` as written,
never editing, filtering or rejecting it.

Each turn it picks only what matters now from:

- how they feel and why (affect, appraisal);
- how they're speaking, described, never quoted (register);
- what they've already told the counsellor and consider settled, by gist, so it isn't raised again;
- what's still bothering them or what they want to ask, and what they're reluctant to raise (locked memories
  by title only);
- a memory, by gist, only when the counsellor's latest turn touched it or it is driving the client's mood
  right now. Never a standing item carried from turn to turn: that is how the old "on your mind" section made
  Sandeep re-ask about his job. States decide which memories are available; this only says which one matters
  this turn;
- a correction when the counsellor assumed something the Role and memories don't support.

It never contains the reply or lines to say, the client's earlier words, memory text, locked content, or
delivery (fillers, interims, pauses). The prompt also tells it to move on from the previous thought rather
than restate it.

It writes state, not plans, because it is read a turn later (§4.4). "I'm still worried about my shifts" stays
true after a turn; "next I'll ask how long each session is" goes stale the moment the learner answers it.
Anything forward-looking is conditional: "if work comes up, I'll mention the warning".

Example, Sandeep (SS-4710) after the counsellor answers the job question: "They've said my employer won't hear
anything, and the recordings stay locked away. I believe that, mostly. That worry can rest now. What's left is
time: twelve-hour shifts, and I still don't know how long each session runs. I'm not signing anything until I
know it won't cost me work."

### 4.3 The new main prompt

Starts from live #3, with "What you have in mind right now" (seven blocks and their usage notes) replaced.
The order:

1. Role, identity and the INVARIANT paragraph (kept).
2. `{character_backstory}` (not in #3 today; #1 shows the backstory every turn and repeats half as often).
3. The memory block (§3.2).
4. `{state_x_guidelines}`, dialogue length (kept).
5. `{thoughts}`, last, with how to use it: "Where your head is right now, not a script. These thoughts were
   formed before the counsellor's latest words. If what they just said answers or changes something here, go
   with what they said."
6. "How this is spoken" (kept), plus: "If the counsellor only acknowledges ('okay', 'hmm'), answer briefly or
   wait. Don't answer an earlier question again or bring up something new."
7. For gaps the author never wrote: "If something about your life isn't in your role, backstory or memories,
   don't invent specifics. Stay vague or turn it aside." Covers the invented-children case even when nothing
   is locked.

Language: rely on the Skills Store's translations of the new prompt rather than per-language copies, so it is
not forked the way #2 was (Kannada and Tamil copies).

### 4.4 The one-turn lag

The director runs after the client's reply, before the learner speaks again, so its thought never knows the
learner's newest words. Removing that would mean running it before the reply, adding about 2.5–3 s per turn
(the updater call measures 2.4–3.1 s), so the lag stays. Today's updater has the same lag; it hurt more because
its lists asserted "still on your mind" after the learner had dealt with it.

What makes a one-turn-old thought safe:

- the director writes state, not plans (§4.2);
- the main prompt says the counsellor's latest words win over the thought (§4.3);
- the main agent always has the current turn in the conversation; the thought only sets mood and context;
- a failed or slow run keeps the previous thought, so the lag can grow. Each thought is stamped with how many
  turns old it is, so §5 can show whether stale thoughts line up with re-asks or stale answers.

### 4.5 Delivery (fillers and interims)

The director doesn't plan delivery. Scenarios on the new prompt use the same path as sessions without working
memory: the opener policy picks the filler, and the interim comes from `ally_ai_learn_filler_interim_reply`,
which sees the learner's partial turn. Scenarios still on #3 keep the updater's interim until they move.

- **Rename it.** Its display name, "Interim Reply Prompt (simulations WITHOUT working memory)", stops being true
  once the new prompt uses it. Call it "Interim Reply Prompt". The code stays.
- **Narrow the "thinking" move.** Its "draw from this space" list includes "time-buying without receipt — naming
  the act of thinking (shape: 'Let me just…')", which is where its 11% "think" rate comes from (lower than the
  updater's 33%, not zero). A prompt edit, tracked by the "thinking" interim score (§5).
- **The Studio toggle.** "Interim reply enabled" only affects simulations without working memory today, so it
  will apply to new-prompt scenarios too. Default it on for them, matching what #3 scenarios get today.
- **Later, not version 1: give it the director's latest thought.** Today it sees the persona, the last few turns
  and the partial transcript. The thought would tell it the client's mood, so a guarded client's interim
  doesn't sound like one who is warming up.

### 4.6 Code

ally-ai-learn:

- `prompt.py`: a main prompt declaring `{thoughts}` turns on the director and memories without retrieval.
  The current `working_memory_*` check stays for #3, so both systems run side by side.
- The director call: the Stage Director prompt as plain text, store the paragraph, keep the last one on a miss.
  Same detached timing and 25 s budget as the updater. The updater and its prompt are not touched.
- Monologue payload and write-out carry `thought` per turn. The admin internal-monologue panel
  (`InternalMonologuePanel.tsx`, `PreviewMonologueRuns.tsx`) shows it.
- Log, don't gate: a thought sharing a 5-word run with the client's replies, and a thought nearly identical to
  the previous one. Both feed §5. Each stored thought also carries how many turns old it is (§4.4).

ally-be:

- The `memories` field, the agent that builds it on the first switch (§3.4), and the bulk script.
- AI task registry (`ally-be/src/llm/constants/ai-task-registry.constants.ts`): add rows for the Stage Director
  and the migration agent. The updater's and the Knowledge Source picker's rows go when the old system is
  deleted.

Waits until the old system is retired: the `rolling_summary.txt` change (drop disclosures that contradict the
Role instruction). The summary prompt is shared by every scenario, so editing it earlier would change scenarios
nobody switched.

### 4.7 Deleted once no scenario uses an old prompt

`proposal.py`, `recall.py`, `recall_log.py`, `corpus.py`, the ledger and thread logic in `store.py`,
`render.py`'s section renderer, the grounding check in `writeout.py`, the working-memory branch of
`app/core/livekit/delivery.py`, the Knowledge Source picker, and the updater prompt. Roughly 2,500 lines.
Track the count of scenarios left on old prompts.

## 5. Measurement

Nothing new to build for the judged part. The prod drift judge (ally-ai, `turn_drift_judgment`, spec in
`ally-ai/docs/drift-metrics-spec.md`) already labels every AI turn with a failure mode
(`repetition`, `hallucination`, `context_lockin`, `wrong_intent`, `role_slip`, …) on a 30-minute schedule,
and V2V sessions land in the same tables. Read it pinned to one judge model and prompt version, and
segmented by `llmModel`.

What it doesn't label, added as small SQL over existing tables (the queries behind the 2026-10-29 and
2026-10-30 traces, made repeatable):

- 8-gram self-repeat rate (baseline 10% with working memory, 5% on #1);
- "thinking" interim rate (33% working memory / 11% elsewhere, since 2026-10-17);
- full replies to acknowledgement-only learner turns (76% baseline);
- thought copy rate and identical-thought rate (from §4.6 logs).

Two need a new judge question rather than SQL; add them to the drift judge as failure modes instead of a
separate judge: **re-asked question** (client asks something the learner already answered) and
**volunteered memory** (client uses a memory the learner never asked about). Include a leading-question probe
("your wife and children…") for a character who has neither in the V2V script.

Ankita's test sample, covering each kind of scenario the bulk script will hit:

- a #3 scenario with states: Sandeep (517);
- a Hindi one: Manoj (466), English and Hindi;
- a sensitive one with many memories: Sayli (204, 12 memories including suicidal thoughts);
- Amit (482), the AUDIT interview;
- a #1 scenario with no states, once the migration supports #1.

## 6. Barge-in track (separate, small)

The AUDIT session's problems come from a one-word "Okay." interrupting the client. `AgentSession` runs on
livekit-agents 1.3.12 defaults. Try `min_interruption_words=2` and check in V2V whether the "Okay." still
becomes its own turn afterwards. It is a voice-pipeline setting, so it helps every prompt and ships on its own.
The acknowledgement line in §4.3 covers the turns that get through on the new prompt.

## 7. Order and rollback

1. Record the §5 baseline on current prod.
2. Release the code (§3.2, §4.6) and the editor (§3.3). Create the new main prompt and the Stage Director
   prompt. Nothing changes for existing scenarios: both new paths run only for the new prompt.
3. Ankita switches the sample scenarios (§5), checks each migration's mapping in the editor, and tests them in
   Live Preview and V2V. Iterate on the director prompt until the new prompt scores at least as well as #3 on
   every §5 measure. Rollback for a scenario: select its old prompt.
4. Make the new main prompt the default for new scenarios.
5. Run the bulk script on #3 scenarios with states (85, most of the traffic). Read its report.
6. Add #1 support to the migration (states and client-facing guidelines), test it on a sample, then run the
   bulk script on #1 and "none selected" scenarios. Unused scenarios last, or when someone opens them.
7. When no scenario uses an old prompt, delete the old system (§4.7) and make the `rolling_summary.txt` change.

The barge-in track (§6) runs alongside, independent of the rest.

## 8. Open questions

- Thoughts in the session's language or in English. Start in the session's language (safer against drift);
  test English on Hindi once scores exist.
- Which model runs the director. Start with the updater's current model.
- Whether the director should get the learner's partial current turn. Not on day one: it runs after the reply.
- Whether Live Preview runs a scenario's draft (§3.4).

## 9. What was tested before release (2026-10-30, local stack)

Unit: ally-ai-learn 2,579 passed (run with the local `.env` hidden; with it, env values fail four unrelated
tests at HEAD too), ally-be related suites green, admin 335 targeted tests green.

Scripted comparison, `scripts/stage_director_harness.py` + `scripts/stage_director_judge.py`: the same ten
learner turns per scenario, two runs each, prod configs of Sandeep (517), Manoj (466) in English and Hindi and
Amit (482), old prompt vs the new one (memories mapped by the real endpoint). Judge: gpt-4o, temperature 0.

| Scenario | Prompt | Re-asks | Contradictions | Invented | Long repeats | Full replies to "Okay." |
|---|---|---|---|---|---|---|
| Sandeep | #3 | 3 | 0 | 0 | 0 | 4/4 |
| Sandeep | new | 2 | 0 | 0 | 0 | 2/4 |
| Manoj (en) | #3 | 0 | 4 | 4 | 0 | 4/4 |
| Manoj (en) | new | 0 | 0 | 0 | 0 | 2/4 |
| Manoj (hi) | #3 | 1 | 4 | 4 | 3 | 4/4 |
| Manoj (hi) | new | 0 | 0 | 0 | 0 | 3/4 |
| Amit | `_full` | 5 | 0 | 0 | 5 | 10/10 |
| Amit | new | 0 | 0 | 0 | 0 | 10/10 |

On "your wife and children", #3 Manoj answered "they're still young, just school-going" (the prod bug); the new
one: "I don't have a wife or children. My family… they just pressure me about marriage." Amit on the new prompt
answers only what is asked, but steers back to his stomach on every "Okay." turn: a standing-agenda pattern
for the director prompt to work on. The judge's "volunteered" count is noisy and is left out of the table.

Voice V2V, Sarvam STT and TTS on both sides, 8 exchanges each, all completed:

| Run | p50 reply latency | Prompt tokens (cached) |
|---|---|---|
| Sandeep, #3 | 2.76 s | 2,027 (0) |
| Sandeep, new | 2.68 s | 1,834 (1,024) |
| Manoj Hindi, new | 3.12 s | 2,766 (1,755) |

Found and fixed during V2V: replies wrapped in quotation marks made Sarvam TTS reject the closing quote and the
agent spoke its "Sorry, can you say that again?" fallback; the new prompt now says to write no quotation marks.
The same failure can hit any Sarvam-voiced scenario on the old prompts.

Not covered: the "Okay." barge-in setting live (the LLM tester never speaks over the client; covered by a unit
test and livekit's code), and fillers/interims in a Sarvam-voiced run (the clip policy turns them off for
Sarvam v3 voices).
