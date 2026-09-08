# AI video actor (experimental)

**Status: no session publishes video.** The platform-level switch is on so an
operator has one lever to pull, but the two gates that actually decide are off:
no roleplay has the flag, and no admin can see the switch to set it. No vendor
plugin is installed either.

Gives a roleplay's character a face: a lip-synced video track published into the
same LiveKit room as its voice, so the learner sees a talking head instead of a
static call card. Nothing about STT, the LLM turn, turn detection or TTS
changes — this sits strictly after TTS, on the output side.

Code: [`app/core/livekit/video_actor.py`](../app/core/livekit/video_actor.py).

## Turning it on

Three gates. All must be satisfied, and the two that matter default to off:

| Gate | Where | Default | What it means |
|---|---|---|---|
| `video_actor` | ally-be admin feature toggle, per platform admin | **off for everyone** | who can *see* the per-roleplay switch in Studio |
| `videoActorEnabled` | the roleplay's `scenarios.metadata` | **off (absent)** | whether *this* roleplay gets a face |
| `VIDEO_ACTOR_ENABLED` | ally-ai-learn env | on | the operator's kill switch |

Read it in that order. The admin toggle decides who may author it, the roleplay
flag decides where it happens, and the env var is the lever to stop all of it at
once without editing a single roleplay.

The global switch being on is not the feature being on. It defaults on precisely
so that it stays useful as a kill switch: the interesting decision lives in the
per-roleplay flag, and no roleplay sets it. Absence there is off, not "no
preference" — every roleplay in the database omits the key and every one of them
keeps running audio-only.

To actually see video: grant an admin the `video_actor` toggle in Admin User
Management, have them turn the switch on for one roleplay, and run that
roleplay. The admin toggle is deliberately not granted by default — this has a
real cost and latency profile and is not something an author should be able to
switch on for a live cohort on a whim.

## Providers

`VIDEO_ACTOR_PROVIDER` — defaults to `tavus`.

That default is a safety choice, not a convenience one. An unconfigured
deployment (no key, no replica id) falls back to **audio-only**, which costs the
learner nothing. Defaulting to `test_pattern` instead would mean a
misconfiguration renders them a coloured blob, which is worse than no video.


* **`test_pattern`** (default) — renders in this process with numpy. No extra
  dependency, no vendor account, no per-minute bill, and **not AI-generated
  video**: an audio-reactive placeholder. It exists to prove the
  publish → subscribe → render path end to end without buying anything first.

  It does **not** tell you what a hosted avatar will cost in bandwidth, and an
  earlier version of this page wrongly said it did. The placeholder is a static
  image whenever the character is silent, so the encoder emits almost nothing
  and a subscriber measures near-zero frames; a real talking head is in
  constant motion and never gets that discount. Measured locally: the generator
  holds ~14fps of its configured 15, but received frame rate swings with
  whether the character is speaking. Use it for path validation and worker CPU,
  and get bandwidth from a vendor trial.
* **`tavus`** — real AI-generated streaming video, and the vendor this
  platform is wired for. `livekit-plugins-tavus` is pinned in `pyproject.toml`
  to the same version as `livekit-agents`, deliberately: the plugin's
  `AvatarSession` signature changed across minors (`replica_id`/`persona_id`
  here, `face_id`/`pal_id` from 1.5), so it must not float independently of the
  runtime it plugs into. Needs `VIDEO_ACTOR_API_KEY` (or `TAVUS_API_KEY`) and a
  **replica id** — the face — in the roleplay's `videoActorAvatarId` or
  `VIDEO_ACTOR_AVATAR_ID`.

  Leave `VIDEO_ACTOR_TAVUS_PERSONA_ID` unset. Tavus falls back to a stock
  persona, which is what we want: the character's personality comes from our
  prompt and our LLM, and a vendor persona would put a second, unversioned
  character definition in the loop where nobody would think to look for it.
* **`bey`** — Beyond Presence. Installed and pinned alongside Tavus. Takes a
  plain `avatar_id` plus `VIDEO_ACTOR_API_KEY`. Worth reaching for when the
  requirement is "English, working, now": it claims ~100ms speech-to-video and
  1000+ concurrent sessions against Tavus's 15, and Tavus measured a **4.7s**
  start here. The trade is expressiveness — it renders from a single still
  image, so it carries less of the facial nuance that the nonverbal-cue use
  case depends on.
* **`anam` / `simli`** — mapped but their plugins are not installed. Add the
  `livekit-plugins-<name>` package to use one; the import is lazy, so an absent
  one logs a line and runs audio-only rather than failing worker boot for every
  session.

  (`hedra` was dropped: its LiveKit plugin is deprecated upstream.)

### The guard that stops a silent session

A vendor's `start()` returning successfully means only that it **accepted the
job**. It is not a promise that a face ever arrives — and by the time it
returns, the agent's speech has already been routed to that avatar.

Tavus's own audio output is built with `wait_remote_track=KIND_VIDEO`: the
plugin will not send the agent's speech anywhere until the avatar's video track
exists. So a vendor that starts and then never publishes leaves the agent's
audio both **suppressed** (we handed it to the avatar) and **undelivered** (the
avatar never became ready). The learner gets silence *and* no picture — strictly
worse than never enabling the feature.

That is not hypothetical. Against a live Tavus account on 2026-09-07:
conversation `active`, replica valid and trained, avatar joined the room, **zero
tracks published**, and an opening statement that took **25.8s** to "play out"
against ~3s without the avatar.

So both start paths wait for the avatar to actually publish video before
accepting it — `VIDEO_ACTOR_PUBLISH_TIMEOUT_S` (default 8s) on the blocking
path, `VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S` (default 30s) on the deferred one,
which can afford to be generous because the learner is mid-conversation and
hearing the character while it runs. If the avatar does not publish, it is torn
down and the session runs audio-only. Verified live on the blocking path: the
guard fires, `roomio_audio` returns, and playout drops back to 3.7s.

On the deferred path the same vendor failure is milder by construction: the
speech never left the room track, so there is nothing to restore and no window
in which the learner could have heard silence. See **The one dangerous edge**
below.

Two things that make this correct rather than merely present:

* **The overall budget covers both phases.** An earlier version wrapped
  everything in `VIDEO_ACTOR_START_TIMEOUT_S` alone, so the verification was
  cancelled before it could finish — dead code, and the cancellation landed
  mid-flight where cleanup had not run.
* **`start_video_actor` guarantees the audio output is restored on every
  abandonment path**, timeout included. Restoring only inside the inner
  functions is not enough, because a timeout cancels them. This matters because
  `AgentSession.start()` inspects `output.audio`: finding a non-None value it
  quietly disables room audio, assuming something else delivers the speech. Left
  pointing at a dead avatar, that assumption is false and the learner hears
  nothing. **If this function returns `None`, the session's audio output is
  exactly as it found it** — that invariant is the whole safety story.

### Vendors disagree about their own arguments

`HOSTED_PROVIDER_KWARGS` maps each provider to a builder that constructs its
constructor arguments. That indirection is not ceremony — every vendor wants
something different, and three of four reject the obvious guess:

| Provider | Argument | API key |
|---|---|---|
| `bey` | `avatar_id="..."` | alongside |
| `tavus` | `replica_id="..."` (+ optional `persona_id`) | alongside |
| `anam` | `persona_config=PersonaConfig(name, avatarId)` | alongside |
| `simli` | `simli_config=SimliConfig(api_key, face_id)` | **inside the config** |

The first implementation sent `avatar_id` to all of them. A wrong kwarg raises
`TypeError`, which this module turns into a clean audio-only fallback — so
those vendors would have been permanently broken with nothing in the logs but
"failed to start". A provider in the module map with no builder is now refused
loudly rather than guessed at.

**Adding a vendor:** download the wheel and read the real `AvatarSession`
signature. Published vendor docs track a newer `livekit-agents` than we pin and
describe different argument names — Tavus's docs say `face_id`/`pal_id`, which
is 1.5+; at our 1.3.12 it is `replica_id`/`persona_id`. Then add a builder and a
test that binds it against the installed signature.

### Two traps specific to a hosted avatar

**It joins as its own participant.** `tavus-avatar-agent` shows up in
`room.remote_participants` alongside the learner. This worker has two "is anyone
still here?" checks — the orphan deadline and the pause guard — and both now go
through `human_participants()`, which filters avatars out. Unfiltered, a learner
who closes the tab before connecting leaves an agent that never notices it is
alone, holding a worker slot **and a metered vendor conversation** open until
the max-duration cap fires.

**It dials LiveKit server-side, so it needs the job's URL — in client form.** The
plugin defaults to reading `LIVEKIT_URL` from our environment. That is the wrong
value for the same reason the Krisp gate cares (see `audio_filters.py`): a
worker registers with `settings.LIVEKIT_URL`, but each job's room lives on
whatever media URL the server assigned *that job*. Hand over the registration
URL and the avatar can join a different server than the learner — which looks
like "video never arrives", with no error anywhere. `_start_hosted` passes the
job URL explicitly.

The scheme matters as much as the host. That job URL can arrive as `https://`
— the API form, not the client form — and vendors disagree about it. Tavus
normalises silently; Beyond Presence returns
`400 Invalid LiveKit URL. Expected format: ws[s]://<host>[:<port>]`, which
reaches the worker only as "failed to start" and a session that quietly runs
audio-only. `_as_websocket_url` rewrites the scheme and leaves the host alone;
a regional media host dials fine once it is `wss://`.

Adding a hosted provider means adding its row to
`ally-be/src/llm/constants/ai-task-registry.constants.ts` in the same change —
a rendered avatar is a model call like any other. The `video-actor` row is
already there.

## The one dangerous edge

Publishing an avatar means telling `AgentSession` to stop publishing its own
audio (`RoomOutputOptions(audio_enabled=False)`), because the avatar
republishes it in sync with the video. If the avatar is half-started, **the
learner hears nothing** — which is worse than any missing face.

There are two orderings, and which one you get decides how bad that edge is.

### Deferred attach — the default

The session starts audio-only and the face arrives later, the way a video call
lets you join with the camera off and turn it on once it is ready. This is
`attach_video_actor`, selected by `VIDEO_ACTOR_DEFER_ATTACH` (default on) for
every hosted vendor:

1. Gates checked first, same as ever. Off → nothing is imported, allocated or
   connected.
2. `session.start()` runs with the agent publishing its **own** audio track, so
   the opening statement is spoken on time. The learner's session is
   indistinguishable from an audio-only one at this point.
3. A background task starts the vendor. Its `start()` ends by pointing
   `session.output.audio` at its own data stream, which is built with
   `wait_remote_track=KIND_VIDEO` and withholds every frame until the avatar's
   video exists — so this path takes that back **immediately**, with no `await`
   in between, and the learner stays on the track they are already hearing.
4. Once the avatar's video is verified live (`VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S`,
   default 30s), the speech moves onto it at a gap between utterances.

That removes the dangerous edge rather than mitigating it. **The agent's audio
is never suppressed on the strength of a vendor promise**, so a vendor that
accepts the job and renders nothing — which both Tavus and Beyond Presence have
done in live testing — costs a faceless session instead of a silent one. The
learner has been hearing the character throughout.

Two library facts make the swap safe rather than clever, both verified against
the pinned `livekit-agents` 1.3.12:

* `AgentActivity` re-reads `session.output.audio` at the start of each speech
  task and holds it for that task's duration. A swap between turns is total; a
  swap mid-utterance leaves that utterance to finish on the track it started
  on, so the worst case is one line that is heard but not lip-synced.
* The room's audio output stays published after the swap and simply stops
  receiving frames. Nothing is torn down, nothing is re-established, and no
  client hears a second voice.

Deferred sessions pass `RoomOutputOptions(sync_transcription=False)`. RoomIO
would otherwise wrap the room's audio output in a transcript synchronizer and
pace the agent's captions against audio that had stopped flowing through it.
Nothing in this platform consumes LiveKit room transcriptions — the transcript
is built from the events this worker emits — so unsynchronised captions cost
nothing, whereas a half-swapped output chain would be a puzzle for whoever met
it next.

A side benefit worth knowing when reading client telemetry: a deferred session
publishes real agent audio within the normal startup window, so the helpline
client's first-audio timings mean the same thing they do for an audio-only
session. In the blocking order the agent has no audio track of its own at all.

### Blocking start — `VIDEO_ACTOR_DEFER_ATTACH=false`

The original ordering, kept as the one-restart revert if the swap ever
misbehaves, and used unconditionally by `test_pattern` (which renders
in-process in milliseconds and has no delay to hide):

1. Gates checked first. Off → `start_video_actor` returns `None` before
   importing, allocating or connecting anything. A session that has not opted
   in costs one boolean read more than it did before this feature existed.
2. Opted in → connect to the room, then start the actor under a bounded
   timeout (`VIDEO_ACTOR_START_TIMEOUT_S`, default 6s). The connect-first
   reorder is inside the gate: a hosted avatar is dispatched into the room by
   name and needs a room that exists, but reordering connect for every session
   to serve an opt-in experiment is exactly the blast radius this avoids.
3. Only a live handle earns `audio_enabled=False`.

The cost of this path is the reason the other one exists: a hosted vendor takes
5–12s to render, and here every second of that is a second before the character
says its first word. A vendor that fails pays the most — the full
`VIDEO_ACTOR_START_TIMEOUT_S + VIDEO_ACTOR_PUBLISH_TIMEOUT_S` before the
session starts at all.

### The character's voice comes out of its face, or not at all

The thinking filler, the back-channel and the interim reply do NOT go through
`session.output.audio`. All three play through `BackgroundAudioPlayer`'s own
published track — deliberately, so none of them can race or preempt the agent's
real reply the way `session.say()` on the shared speech channel would.

That separate track never reaches the avatar renderer. So with video on, those
layers put the character's **voice** in the room while the learner watches a
**motionless mouth** — audio and video plainly disagreeing, which reads as a
broken session rather than as naturalness. It is the one contradiction video
cannot absorb, because audio-visual agreement is the entire thing the feature
was added for. Stacks' *Natural Dialogue Preserves Immersion in Simulations*
makes the general point for dialogue that feels artificial; a voice with no
matching mouth is the audio-visual form of it.

So `VIDEO_ACTOR_MUTE_VOICE_LAYERS` (default on) suppresses all three **while the
avatar is actually carrying the speech**. Two things about the scope:

* **The comfort room tone is untouched.** It is the player's `ambient_sound`,
  not a `play()` call, and ambient sound has no mouth to disagree with. The line
  still never sounds dead.
* **It is dynamic, not decided at setup.** A deferred session has no face for
  its first 5-12s, and those are exactly the seconds a filler is worth most, so
  the layers run normally until the swap commits. `_voice_on_avatar()` reads
  `publishes_audio`, which is true only after the swap.

These layers are also less needed here, which is why suppression rather than
some cleverer routing is the right trade: a present, visibly listening face
already does a filler's job of stopping a pause from feeling dead.

Routing them *through* the avatar instead — so they would be lip-synced — was
considered and rejected. `DataStreamAudioOutput` has a single `_stream_writer`,
so a filler and a reply writing concurrently would interleave PCM into one
stream and produce garbage; avoiding exactly that race is why these layers got
their own track in the first place.

A suppressed turn records `fillerDecision = skipped_video_actor`, its own
bucket in `turn_metrics.FILLER_DECISIONS`. It must not be folded into
`skipped_probability`: that would make the cadence gate look like it declined
turns it never saw, and `fillerDecision` is how filler coverage — the share of
*slow* turns actually masked — is measured. Note `note_filler_decision` is a
deliberate no-op for an unregistered decision, so a new reason that skips the
allow-list records nothing at all.

#### The timing bug this also closes

`agent_state == "speaking"` is **not** "the learner can hear the character" when
an avatar is in the path. The state flips off `AudioOutput.on_playback_started`,
and the two outputs mean different things by it:

* the room output fires it when the first frame is actually captured into the
  published audio source — accurate;
* `DataStreamAudioOutput` fires it when the first frame is written into the byte
  stream *to the vendor*, carrying livekit's own comment: *"Not ideal since
  frame isn't actually playing yet / potentially we need another RPC for this"*.

The filler stop is timed off that transition (`_stop_filler` cuts the clip and
flushes its buffered tail), so on a video session the filler was cut at
frame-handover and the learner then heard **silence** for the vendor's whole
transport-plus-render time before the reply arrived. Suppression removes that
too: post-attach there is no filler to mis-time, and pre-attach the room output
reports the transition accurately.

The same skew still makes `response_latency_ms` optimistic on video turns, and
that cannot be fixed from here: no vendor exposes a "playback started" signal,
only `RPC_PLAYBACK_FINISHED`. So the turn is **identified** instead. Every turn
records `metadata.speechTransport` (`room` | `avatar`, plus
`speechTransportProvider`), written on plain audio turns too so that a missing
value means "a build from before this shipped" and nothing else. A deferred
session legitimately reports both, since it swaps mid-session.

Any latency chart must split on it, for the same reason it must split on
`source`: on `room` the number is timed to the first frame actually published,
on `avatar` it is timed to the first frame handed to the vendor. See
`turn_metrics.SPEECH_TRANSPORTS`, and note the transport is derived from
`_speech_on_avatar()` — deliberately NOT `_voice_on_avatar()`, which folds in
the filler preference and would relabel avatar turns as plain audio ones if
that preference were turned off.

### Either way, the client is told nothing

Every failure — bad config, missing plugin, vendor timeout, exception
mid-start — leaves the session running on plain voice. `ActorVideo` in ally-web
renders `null` until a track genuinely arrives, so "no face" is an ordinary
resting state there, never an error or a spinner. That is also what makes the
deferred path need no client change at all: a face that appears 8s in looks the
same to that component as one that was there from the start. A learner who
never knew a face was coming is not shown its absence mid-conversation.

## Vendor traps found in live testing (2026-09-07)

Three of these cost a full day of debugging between them, because every one of
them presents as the same thing: a clean `[VIDEO_ACTOR] started provider=…`
line followed by a session that is **completely silent**. Agent audio rides the
avatar track, `DataStreamAudioOutput` withholds every frame until the avatar
publishes a *video* track, so a vendor that starts but never renders takes the
voice with it. Read `## The one dangerous edge` above, then this.

### Tavus must be given the registration URL, not the job URL

Tavus cannot publish into a room that **already has participants** when it is
pointed at a regional media host. It connects, joins as `tavus-avatar-agent`,
publishes nothing, and leaves ~25s later. It needs both conditions at once,
which is why it survives every single-variable test. Measured with one replica,
one echo PAL and one token shape:

| URL handed to Tavus | Room | Result |
|---|---|---|
| regional job url | occupied | **never publishes** |
| regional job url | empty | publishes in 11.8s |
| project url | occupied | publishes in 5.3s |
| project url | empty | publishes in 8.4s |

`PROVIDERS_NEEDING_REGISTRATION_URL` carries this. It is a per-provider set
rather than a revert of the job-url change, because that change is right for
the reason it was made — a vendor has to land on the same media server as the
learner — and Beyond Presence handles the regional host fine. Every real
session before this fix fell in the failing cell.

### The Tavus conversation is ours to end

`livekit-plugins-tavus` has no `aclose()` on its `AvatarSession` — not in the
1.3.12 we pin, and not in 1.5.6 either — so the conversation it opens with
`POST /v2/conversations` outlives the room, metered, until Tavus's own timeout.
`_end_tavus_conversation` ends it. This is billing, not rendering: conversations
do get cleaned up eventually, so a leak here never blocked a later session.

### Pin one echo PAL rather than letting the plugin create one per session

With `persona_id` unset the plugin calls `create_persona` on **every** session:
one throwaway PAL each time (12 sessions produced 12 of them), plus an HTTP
round trip in front of `session.start`. Setting
`VIDEO_ACTOR_TAVUS_PERSONA_ID` to one reusable PAL cut time-to-tracks from
9.08s to 6.33s. It must be `pipeline_mode: "echo"` with a `livekit` transport
layer — those two are mandatory for the LiveKit path, and echo mode is also
what keeps the vendor from contributing a personality of its own, which is the
property the unset default was reaching for anyway.

### Vendors differ on when they publish

Tavus publishes on join. Beyond Presence waits for audio to lip-sync before it
publishes anything. Neither is wrong, but it means "joined but no track yet" is
not diagnostic on its own, and a probe that sends no audio will look like a bey
failure when bey is healthy.

## What to measure before rolling this anywhere

Latency is the product here, so the questions worth answering before a wider
pilot are:

* **Time to first word**, against the audio-only baseline for the *same*
  roleplay. With the deferred attach this should now be flat — the avatar is no
  longer in front of `session.start` — so a difference here is a finding, not a
  known cost. What remains is the per-turn cost: hosted vendors round-trip the
  TTS audio through a renderer, and that only starts once the face attaches.
* **Time to first face**, from the `[VIDEO_ACTOR] provider=… attached …ms into
  the session` log line. This is what the deferred path traded the startup
  delay for, and it is the number to watch per vendor.
* **Egress.** Our LiveKit is self-hosted; video is roughly 10–30× Opus audio
  per session. `VIDEO_ACTOR_WIDTH`/`HEIGHT`/`FPS` default low (480×480 @ 15fps)
  for that reason. Measure this against a hosted provider, not `test_pattern`
  (see above).
* **Lip-sync outside English.** Materially worse for Hindi, Tamil and Telugu at
  every vendor. A visibly wrong mouth is worse than no face, and Indic coverage
  is a differentiator.
* **Completion and drop-off**, same roleplay, with and without.

The product case for this is *not* "more realistic". It is that reading
incongruence between what a client says and what their body does, and
SOLER-style attending, are teachable skills that cannot be practised or scored
at all without video. Transfer comes from replicating the mental steps of the
job, not from visual fidelity — so if reading the character's face is not in a
roleplay's rubric, that roleplay should not have one.
