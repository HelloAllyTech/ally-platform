"""Plays each turn's opening: the runtime half of the delivery plan.

``opener_policy`` decides WHAT the learner hears before the reply; this class
makes it happen on the shared background-audio track and keeps the turn honest:

* at the agent's "thinking" state it asks the policy for a decision and records
  it on ``TurnDelivery`` straight away, so the reply prompt (built a few hundred
  ms later) knows what is about to be said;
* it waits out the randomised hold, plays the filler, then the interim pieces
  with the gaps the policy set;
* learner speech at ANY point cancels it and flushes the buffered tail, and the
  turn is marked so the overlap is measurable;
* the real reply taking over ("thinking" ends) cuts whatever is still playing.

Fillers come from the session catalog, rendered once at setup, and each plan's
interim pieces are rendered in the background as the plan arrives, so nothing
here makes a network call on the turn. Every entry point is best-effort and
never raises into the session.

Where the interim comes from depends on the scenario:

* **working memory** — the updater writes 1-3 pieces into the plan after each
  reply (``on_plan`` renders them);
* **no working memory** — the separate interim generator writes one line while
  the learner is still speaking and hands it over with ``set_live_interim``. If
  it is still rendering when the turn's decision is made, it can still play
  after the filler when the wait leaves room (``_late_interim``).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from app.core.livekit.delivery import DeliveryPlan, OpenerRecord, TurnDelivery
from app.core.livekit.opener_catalog import SessionCatalog, load_asset_clip
from app.core.livekit.opener_policy import OpenerDecision, OpenerPolicy
from app.core.logger import get_logger
from app.core.metrics import turn_metrics
from app.core.tasks import spawn_background_task

logger = get_logger(__name__)


class OpenerPlayer:
    """Session-scoped runner for turn openers."""

    def __init__(
        self,
        *,
        room_name: str,
        turn_delivery: TurnDelivery,
        policy: OpenerPolicy,
        bg_audio_getter: Callable[[], Any],
        predicted_gap_ms: Callable[[], float],
        synthesize: Callable[..., Any],
        emit_filler_transcript: Callable[[str, Optional[float]], None],
        emit_interim_transcript: Callable[[str, Optional[float]], None],
        voice_on_avatar: Callable[[], bool] = lambda: False,
        background_tasks: Optional[Set[asyncio.Task]] = None,
        observe_wait: Optional[Callable[[float], None]] = None,
    ) -> None:
        self._room = room_name
        self.turn_delivery = turn_delivery
        self.policy = policy
        self._bg_audio = bg_audio_getter
        self._predicted_gap_ms = predicted_gap_ms
        self._synthesize = synthesize
        self._emit_filler = emit_filler_transcript
        self._emit_interim = emit_interim_transcript
        self._voice_on_avatar = voice_on_avatar
        self._tasks = background_tasks if background_tasks is not None else set()
        #: Reports each turn's measured wait (thinking -> reply audio) to the
        #: gap predictor, which the timing rules fit the cues into.
        self._observe_wait = observe_wait
        #: When the agent last started thinking; the cues are timed from here.
        self._thinking_at: Optional[float] = None

        #: catalog id -> FillerClip
        self.clips: Dict[str, Any] = {}
        #: catalog id -> how many times it has played, to rotate stored takes.
        self._plays: Dict[str, int] = {}
        #: The current plan's interim: (pieces, clips rendered so far, in order).
        self._interim: Optional[Tuple[tuple, List[Any]]] = None
        self._interim_rendering: Optional[tuple] = None
        #: This turn's line from the interim generator (no working memory):
        #: (text, clip), consumed once.
        self._live: Optional[Tuple[str, Any]] = None

        self._task: Optional[asyncio.Task] = None
        self._handle = None
        self._thinking = False
        self.user_speaking = False
        self._last_learner_text: str = ""
        #: An opener was decided since the last real reply started.
        self._opened_since_reply = False
        self.stats: Dict[str, Any] = {
            "turns": 0,
            "vocal": 0,
            "body": 0,
            "interim_pieces": 0,
            "none": 0,
            "cancelled_by_learner": 0,
        }

    # ---- setup ------------------------------------------------------

    @property
    def catalog(self) -> Optional[SessionCatalog]:
        return self.turn_delivery.catalog

    async def render_catalog(self) -> int:
        """Render every catalog entry once. Returns how many are playable."""
        catalog = self.catalog
        if catalog is None:
            return 0
        text_entries = [e for e in catalog.entries.values() if e.text]
        if text_entries:
            clips = await self._synthesize(
                [(e.text, e.kind, 0) for e in text_entries], source="catalog"
            )
            by_text = {c.phrase.strip().lower(): c for c in clips or []}
            for entry in text_entries:
                clip = by_text.get(entry.text.strip().lower())
                if clip is not None:
                    self.clips[entry.id] = clip
        for entry in catalog.entries.values():
            if entry.is_asset:
                clip = load_asset_clip(entry)
                if clip is not None:
                    self.clips[entry.id] = clip
        return len(self.clips)

    def on_plan(self, plan: DeliveryPlan) -> None:
        """New plan: pre-render its interim pieces so the next turn can play them.

        One clip per piece, so the turn can stop after any of them. The clips
        keep the pieces' order; a piece that fails to render ends the list
        there, because the pieces after it lean on it.
        """
        pieces = tuple(plan.interim)
        if not pieces:
            self._interim = None
            return
        if (self._interim and self._interim[0] == pieces) or (
            self._interim_rendering == pieces
        ):
            return
        self._interim = None
        self._interim_rendering = pieces

        async def _render() -> None:
            try:
                clips = await self._synthesize(
                    [(piece, "interim", 0) for piece in pieces], source="interim"
                )
                by_text = {c.phrase.strip().lower(): c for c in clips or []}
                ordered: List[Any] = []
                for piece in pieces:
                    clip = by_text.get(piece.strip().lower())
                    if clip is None:
                        break
                    ordered.append(clip)
                if ordered and self._interim_rendering == pieces:
                    self._interim = (pieces, ordered)
            finally:
                if self._interim_rendering == pieces:
                    self._interim_rendering = None

        spawn_background_task(
            _render(), name="opener-interim-render", background_tasks=self._tasks
        )

    def set_live_interim(self, text: Optional[str], clip: Any) -> None:
        """This turn's line from the interim generator, ready to play."""
        self._live = (text, clip) if text and clip is not None else None

    def clear_live_interim(self) -> None:
        self._live = None

    # ---- learner signals --------------------------------------------

    def on_user_state(self, new_state: Optional[str]) -> None:
        try:
            if new_state == "speaking":
                self.user_speaking = True
                if self._is_playing() or self._task_pending():
                    self.stats["cancelled_by_learner"] += 1
                    turn_metrics.record(
                        self._room, metadata={"openerCancelledByLearner": True}
                    )
                    if not self._is_playing():
                        # Still in the hold: nothing was heard, so this is a
                        # withdrawn decision, not a played opener.
                        turn_metrics.note_filler_decision(
                            self._room, "cancelled_before_play"
                        )
                    self._cancel()
            else:
                self.user_speaking = False
        except Exception:  # noqa: BLE001 - must never break a session
            logger.warning("[OPENER] user-state handler error", exc_info=True)

    def on_transcript(self, text: Optional[str], is_final: bool) -> None:
        """Keep the learner's latest FINAL words for the unfinished-turn check."""
        if is_final and text and text.strip():
            self._last_learner_text = text.strip()

    # ---- agent state ------------------------------------------------

    def on_agent_state(self, new_state: Optional[str], created_at=None) -> None:
        try:
            if new_state == "thinking":
                self._thinking = True
                # The LAST thinking before the reply: a false endpoint restarts
                # the wait, and the cues are timed from it.
                if created_at is not None:
                    self._thinking_at = float(created_at)
                if self._task_pending() or self._is_playing():
                    return
                self._start_turn(created_at)
            else:
                self._thinking = False
                self._cancel()
                if new_state == "speaking":
                    # A real reply started: the next learner turn may open again.
                    self._opened_since_reply = False
                    self._report_wait(created_at)
                if new_state == "listening" and not self._opened_since_reply:
                    # Back to listening with something heard is a false
                    # endpoint: the same reply is still coming, so keep it.
                    self.turn_delivery.end_turn()
        except Exception:  # noqa: BLE001 - must never break a session
            logger.warning("[OPENER] agent-state handler error", exc_info=True)

    def _start_turn(self, created_at) -> None:
        self.stats["turns"] += 1
        if self._voice_on_avatar():
            self.turn_delivery.begin_turn()
            turn_metrics.note_filler_decision(self._room, "skipped_video_actor")
            return
        if self._opened_since_reply:
            # A false endpoint: the learner paused, HEARD an opener, and went
            # on. Their next pause is the same reply cycle, and a second opener
            # there is two fillers stacked before one reply — seen live as
            # "I mean…" then "Well…". Only an opener that actually played
            # counts (the flag is set at playback): one withdrawn during its
            # hold was never heard and must not silence the rest of the turn.
            # What was heard stays on record for this reply: clearing it (as
            # this used to, and the false endpoint's "listening" did) left the
            # reply neither told about nor trimmed of the interim it follows —
            # a Kannada prod session (2026-10-16) restated it word for word.
            self.stats["none"] += 1
            turn_metrics.note_filler_decision(self._room, "skipped_same_reply")
            return
        self.turn_delivery.begin_turn()
        plan = self.turn_delivery.plan
        predicted = float(self._predicted_gap_ms())
        durations = {k: float(c.duration_ms) for k, c in self.clips.items()}
        # Only this plan's own pieces: a render still running for an older plan
        # must not put last turn's words in front of this reply.
        interim = self._interim
        clips = interim[1] if interim and interim[0] == tuple(plan.interim) else []
        texts = tuple(plan.interim)
        interim_source = "bridge"
        if not plan.interim and self._live is not None:
            # No working memory: the generator's line is this turn's interim.
            texts, clips = (self._live[0],), [self._live[1]]
            interim_source = "legacy"
        decision = self.policy.decide(
            plan,
            self.catalog,
            durations,
            predicted,
            learner_text=self._last_learner_text,
            piece_ms=[float(c.duration_ms) for c in clips],
        )
        self.policy.record(decision)
        details = {
            "fillerPredictedGapMs": int(predicted),
            "openerPlanSource": plan.source,
            "openerPlanKind": plan.opener_kind,
            "openerPlanHold": plan.hold_silence,
            "interimPiecesPlanned": len(plan.interim),
            "interimPiecesRendered": len(clips),
            "interimPiecesScheduled": decision.pieces,
        }
        if not decision.plays_anything:
            self.stats["none"] += 1
            turn_metrics.note_filler_decision(self._room, decision.reason, **details)
            return
        entry = decision.entry
        pieces = texts[: decision.pieces]
        if pieces and interim_source == "legacy":
            self._live = None  # heard once
        self.turn_delivery.note_opener(
            OpenerRecord(
                category=decision.category,
                entry_id=entry.id if entry else None,
                kind=entry.kind if entry else None,
                spoken=entry.text if entry else None,
                interim=pieces,
            )
        )
        self._task = spawn_background_task(
            self._run(
                decision,
                created_at,
                details,
                list(zip(pieces, clips)),
                interim_source,
                late_ok=not plan.interim,
            ),
            name="opener-play",
            background_tasks=self._tasks,
        )

    async def _run(
        self,
        decision: OpenerDecision,
        created_at,
        details: dict,
        pieces: list,
        interim_source: str = "bridge",
        late_ok: bool = False,
    ) -> None:
        from livekit.agents import AudioConfig

        from app.core.livekit.filler_clips import clip_audio_source

        heard: List[str] = []
        heard_ts: Optional[float] = None
        played = 0
        try:
            await asyncio.sleep(max(0.0, decision.hold_ms) / 1000.0)
            if not self._can_play():
                self._withdraw()
                return
            if decision.entry is not None:
                clip = self.clips.get(decision.entry.id)
                if clip is None:
                    self._withdraw()
                    return
                clip = self._next_take(decision.entry.id, clip)
                play_ts = time.time()
                self._opened_since_reply = True
                self._handle = self._bg_audio().play(
                    AudioConfig(clip_audio_source(clip))
                )
                self.stats[decision.category] += 1
                played += 1
                if decision.entry.text:
                    self._emit_filler(decision.entry.text, play_ts)
                self._note_first_audio(
                    play_ts, created_at, clip, decision, details, kind="filler"
                )
                await asyncio.sleep(clip.duration_ms / 1000.0)
                turn_metrics.note_filler_ended(self._room, time.time())
            gaps = list(decision.gaps_ms)
            if late_ok and not pieces and played:
                late = self._late_interim(
                    created_at, details, spoken_ms=clip.duration_ms
                )
                if late is not None:
                    pieces, gaps = [late[0]], [late[1]]
                    interim_source = "legacy"
                    record = self.turn_delivery.opener
                    if record is not None:
                        record.interim = (late[0][0],)
            for (text, clip), gap_ms in zip(pieces, gaps):
                await asyncio.sleep(max(0.0, gap_ms) / 1000.0)
                if not self._can_play():
                    return
                play_ts = time.time()
                self._opened_since_reply = True
                self._handle = self._bg_audio().play(
                    AudioConfig(clip_audio_source(clip))
                )
                self.stats["interim_pieces"] += 1
                if played == 0:
                    self._note_first_audio(
                        play_ts,
                        created_at,
                        clip,
                        decision,
                        details,
                        kind="interim",
                        interim_source=interim_source,
                    )
                elif not heard:
                    # Kept for the analytics' detailed split: an interim that
                    # followed a filler.
                    turn_metrics.record(self._room, metadata={"openerBridge": True})
                played += 1
                heard.append(text)
                heard_ts = heard_ts if heard_ts is not None else play_ts
                await asyncio.sleep(clip.duration_ms / 1000.0)
                turn_metrics.note_filler_ended(self._room, time.time())
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 - must never break a session
            logger.warning("[OPENER] play error", exc_info=True)
        finally:
            if played:
                turn_metrics.record(
                    self._room,
                    metadata={
                        "cuesPlayed": played,
                        "interimPiecesPlayed": len(heard),
                    },
                )
            if heard:
                # One transcript line for the whole interim, as far as it got:
                # three lines for "It's just that… I don't know…" would read as
                # three turns.
                self._emit_interim(" ".join(heard), heard_ts)

    def _note_first_audio(
        self,
        play_ts,
        created_at,
        clip,
        decision: OpenerDecision,
        details,
        kind,
        interim_source: str = "bridge",
    ) -> None:
        turn_metrics.note_filler_started(
            self._room,
            play_ts,
            kind=kind,
            # Stored values ally-be's analytics split on: "bridge" = written by
            # working memory, "legacy" = the separate interim generator.
            interim_source=interim_source if kind == "interim" else None,
        )
        lead = (play_ts - created_at) * 1000.0 if created_at is not None else None
        entry = decision.entry
        turn_metrics.note_filler_decision(
            self._room,
            "played",
            fillerLeadMs=int(lead) if lead is not None else None,
            fillerDurationMs=int(clip.duration_ms),
            fillerClipSource=clip.source,
            fillerType=entry.kind if entry else "interim",
            openerCategory=decision.category,
            openerId=entry.id if entry else None,
            openerHoldMs=int(decision.hold_ms),
            # False until an interim piece actually plays AFTER the filler (it
            # is set there): one the reply cut off was never heard.
            openerBridge=False,
            **details,
        )
        logger.info(
            "[OPENER] playing %s %s (hold %.0fms, interim pieces=%d of %d rendered, "
            "gaps=%s) for a predicted %sms gap",
            decision.category,
            entry.id if entry else "interim",
            decision.hold_ms,
            decision.pieces,
            details.get("interimPiecesRendered", 0),
            [int(g) for g in decision.gaps_ms],
            details.get("fillerPredictedGapMs"),
        )

    def _late_interim(self, created_at, details: dict, spoken_ms: float):
        """The generator's line, if it became ready during the filler and fits.

        Returns ((text, clip), gap_ms) or None. Uses the same fit rule as the
        policy: the line must end a tail before the predicted reply.
        """
        live = self._live
        if live is None or created_at is None:
            return None
        cfg = self.policy.config
        predicted = float(details.get("fillerPredictedGapMs") or 0)
        elapsed = (time.time() - float(created_at)) * 1000.0
        gap = cfg.piece_gap_ms
        d = float(live[1].duration_ms)
        if elapsed + gap + d > predicted - cfg.tail_ms:
            return None
        if spoken_ms + d > cfg.max_speech_share * predicted:
            return None
        self._live = None
        details["interimPiecesScheduled"] = 1
        return live, gap

    def _next_take(self, entry_id: str, clip):
        """The take to play this time: the best first, then the alternates.

        Curated takes come from the clip store; a line heard twice in a
        session is then two different recordings, not a tape loop.
        """
        alternates = getattr(clip, "alternates", None) or []
        if not alternates:
            return clip
        import dataclasses

        count = self._plays.get(entry_id, 0)
        self._plays[entry_id] = count + 1
        takes = [(clip.frames, clip.duration_ms)] + list(alternates)
        frames, duration_ms = takes[count % len(takes)]
        return dataclasses.replace(
            clip, frames=frames, duration_ms=duration_ms, alternates=[]
        )

    def _report_wait(self, speaking_at) -> None:
        started = self._thinking_at
        self._thinking_at = None
        if self._observe_wait is None or started is None or speaking_at is None:
            return
        wait_ms = (float(speaking_at) - started) * 1000.0
        if 0 < wait_ms <= 30_000:
            self._observe_wait(wait_ms)

    # ---- helpers ----------------------------------------------------

    def _can_play(self) -> bool:
        return (
            self._thinking
            and not self.user_speaking
            and self._bg_audio() is not None
            and not self._voice_on_avatar()
        )

    def _withdraw(self) -> None:
        """The hold ran out on a turn that no longer wants an opener.

        The reply started, the learner spoke, or a face attached — either way
        nothing plays, and the record says so rather than "played".
        """
        self.turn_delivery.note_opener(OpenerRecord(category="none"))
        turn_metrics.note_filler_decision(self._room, "cancelled_before_play")

    def _is_playing(self) -> bool:
        return self._handle is not None and not self._handle.done()

    def _task_pending(self) -> bool:
        return self._task is not None and not self._task.done()

    def _cancel(self) -> None:
        if self._task_pending():
            self._task.cancel()
        self._task = None
        if self._is_playing():
            self._handle.stop()
            bg = self._bg_audio()
            if bg is not None:
                # stop() halts the feeder only; the buffered tail would keep
                # playing over the learner or the reply on the other track.
                bg.flush()
        self._handle = None

    def shutdown(self) -> None:
        self._cancel()
        self.turn_delivery.active = False
        for task in list(self._tasks):
            if not task.done():
                task.cancel()
