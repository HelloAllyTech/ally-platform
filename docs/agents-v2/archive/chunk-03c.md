# Chunk 3c — Live agent: streaming steps and replies, WhatsApp typing

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, the NOTES for chunks 1, 2 and 3a, `REVIEW-1-3A.md` (including its refactor summary), then this file.
> Branch: a fresh branch from master after the 1–3r PR is merged: `feat/agents-v2-chunk-03c-streaming`. Repos: all three.

## Why

The agent now thinks in steps (decide → search → maybe search again → check → maybe rewrite), and a reply takes 3–10 seconds. Today the person sees nothing until it's done. This chunk shows what's happening while it happens:

- **Preview** (and later the website widget, chunk 21): a live status line ("Looking up *getting access*…", "Checking the answer…"), the steps filling in, then the reply appearing smoothly.
- **WhatsApp:** it can't stream or edit messages, so it shows a **typing indicator** as soon as a message arrives.

## The one design rule: no unchecked text

The model's draft can be refused by `agent_check` and rewritten, and the crisis check can replace any reply. So **reply text is never streamed while it's being generated.** What streams:

1. **Status and step events, live,** from every node and tool, using the trace data that already exists (counts and labels, no PHI beyond the person's own words in Preview).
2. **The reply,** only after `agent_check` has passed it **and** ally-be's crisis check has cleared. It's then sent as `token` chunks (words or short phrases) so the client can reveal it progressively.
3. **`final`:** the complete response, identical to `/agent/run`'s. **`final` always wins:** if anything differs (decline, crisis, fallback), the client replaces what it showed.

True token-by-token streaming of drafts is **out of scope**. Record it in NOTES as a possible later option, for low-risk bots only.

## Scope

### ally-ai

- **`POST /api/v1/agent/run/stream`** (Server-Sent Events). It takes the same request as `/agent/run`, the same auth, and the same flag (404 when off).
- **Events** (`event:` + JSON `data:`):
  - `run_started` `{run_id}`
  - `status` `{code, label, detail?}`. Codes come from a fixed list: `thinking`, `searching`, `found`, `checking`, `rewriting`, `writing`. `label` is plain English. `detail` is optional: the search query, or "3 passages".
  - `step` `{node, summary, ms}`, the same as a trace step.
  - `token` `{text}`, only after check passes.
  - `final` `{…AgentRunResponse}`
  - `error` `{code}`: `timeout`, `upstream`, `internal`. No messages that could echo input.
  - A heartbeat comment every 10 s.
- **How nodes emit events:** use LangGraph's custom stream writer (`get_stream_writer()`, `stream_mode=["custom", …]` in the installed 1.x). Emit from one helper in `trace.py`, so every node and tool, including future 3b tools, streams with no extra code. `/agent/run` stays non-streaming and unchanged. Implement both on one shared runner, so they can't drift.
- **Hard run timeout (review #62):** wrap the run in `asyncio.timeout(settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS)` (default 25). On expiry, `/agent/run` returns 504 and the stream sends `error {timeout}`. Pass the remaining budget to model calls where dispatch allows, so a run can't outlive ally-be's wait.
- **Client disconnect** cancels the run (no more model calls), and the checkpoint keeps what was saved.
- Headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

### ally-be

- **`POST /v1/chatbots/:id/test/stream`:** the same auth, DTO and access rules as `/test`. It writes SSE to the response, using the repo's existing pattern if one exists; otherwise raw `res.write` with the right headers.
  - It runs the engine's pre-steps (keyword replies, access, kill switch) exactly as `/test` does.
  - **v1 or a template reply:** send one `final` and close.
  - **v2:** start the AI crisis check in parallel, as today, and relay ally-ai's `run_started` / `status` / `step` events as they arrive. **Hold `token` events** until the crisis check has cleared; then send them. On a crisis verdict, drop the held tokens and send `final` with the crisis reply.
  - **Fallback:** if the stream fails or times out before `final`, run v1 within the remaining budget and send its `final` (with `runtime: v2_fallback`), the same rules as chunk 2.
  - `final` carries everything `/test` returns today (handled by, citations, run id, trace, turn type, fallback reason…).
- **Connector capability:** add `streaming: boolean` to the connector type registry. WhatsApp is `false`; the `test` channel (Preview) and the future `web` connector are `true`. The engine never streams to a connector that can't.
- **WhatsApp typing indicator:** when an inbound text message is accepted (after dedupe, kill switch and STOP/consent handling, before the engine), send Meta's typing indicator for that message. **Verify the current Cloud API call in Meta's docs** (at the time of writing, it marks the message as read and shows typing for up to about 25 s or until the reply). Rules:
  - Fire-and-forget. It never delays or fails the reply, and errors are only logged.
  - Per-bot setting **"Show typing"**: default **on** for v2 bots, **off** for v1 (it also turns on read receipts, which is a product choice). Only platform admins can change it in this chunk.
  - Skip it for crisis-keyword messages, since the crisis reply is instant anyway.

### ally-web (Preview)

- Use the stream endpoint via `fetch` + `ReadableStream`. EventSource can't POST. Fall back to `/test` if streaming fails before the first event.
- Show:
  - a **live status line** under the pending bubble ("Looking up 'getting access'…"), animated
  - the **Steps list** filling in live
  - the **reply revealed progressively** from `token` events
  - when `final` arrives, the bubble is replaced with the final text, sources, badges and turn type, exactly as today
- A crisis or fallback `final` visibly replaces anything shown.
- Copy goes in `en.ts`. Status labels are mapped from `status.code`, so they can be translated later.
- Add the "Show typing" toggle to the bot's Settings, next to the other WhatsApp options, admin-only.

## Out of scope

- Streaming on WhatsApp (impossible) or editing sent messages.
- The website widget UI (chunk 21 reuses this endpoint).
- Unchecked token streaming.
- New tools (chunk 3b).

## Tests

**ally-ai:**
- Event order: `run_started` → status/step… → token… → `final`.
- `final` equals `/agent/run` for the same input (mocked model).
- No `token` before check passes.
- A refused-then-rewritten draft streams only the rewrite.
- Timeout → `error {timeout}` / 504.
- A disconnect cancels the run.
- Flag off → 404.
- A tool step streams with no code in the tool.

**ally-be:**
- Relay order.
- Tokens are held until the crisis check clears.
- A crisis verdict drops the held tokens and sends the crisis `final`.
- Stream failure → v1 `final` with fallback.
- A v1 bot gets a single `final`.
- The typing indicator is sent once, after dedupe, never for STOP or a crisis keyword, never blocks the reply, follows the per-bot setting, and its errors are swallowed.
- The `streaming` capability blocks streaming for WhatsApp.

**ally-web:**
- The status line updates.
- Steps appear live.
- Text is revealed from tokens.
- `final` replaces it.
- The fallback to `/test` works.
- The toggle is admin-only.

Run the conversation eval through **the stream endpoint as well** (add a `--stream` flag): `final` must match the non-stream run's checks with 0 hard fails. Parity is unchanged.

## Done when

- [ ] Preview shows live status and steps within about 1 second of sending, and the reply reveals smoothly. The final text equals what `/test` would return.
- [ ] A crisis test message in Preview shows no streamed reply text, only the crisis `final`.
- [ ] A stopped ally-ai mid-stream → the v1 answer arrives, marked fallback.
- [ ] On WhatsApp (after deploy, or locally if a number is connected), the typing indicator shows within about 1 second.
- [ ] Eval via `--stream`: 0 hard fails. Parity: 0 must-match.
- [ ] `CHUNK-03C-NOTES.md`: code map, the event contract, decisions, how to test, open items (true token streaming later; widget reuse in chunk 21).

## How Shehbaz tests it

1. Suites and lint in all three apps; rebuild ally-ai.
2. Preview → New thread → "how do I get access?": watch the status line ("Looking up…"), the steps fill in, and the reply appear. Then "and after that, how do I sign in?", "what's your refund policy?" and "thanks".
3. Send a crisis test phrase you use for testing: no streamed text, just the crisis reply.
4. Stop ally-ai (`AGENT_RUNTIME__ENABLED=false`, recreate) and send a question: the v1 answer arrives, marked as fallback.
5. Settings: the "Show typing" toggle (admin-only). On WhatsApp, if a number is connected: the typing dots appear right after you send.
