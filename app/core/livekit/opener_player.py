"""Plays each turn's opener: the runtime half of the delivery plan.

``opener_policy`` decides WHAT the learner hears first; this class makes it
happen on the shared background-audio track and keeps the turn honest:

* at the agent's "thinking" state it asks the policy for a decision and records
  it on ``TurnDelivery`` straight away, so the reply prompt (built a few hundred
  ms later) knows what is about to be said;
* it waits out the randomised hold, then plays the catalog clip, then — after a
  thinking pause — the pre-rendered bridge line when the policy chose one;
* learner speech at ANY point cancels it and flushes the buffered tail, and the
  turn is marked so the overlap is measurable;
* the real reply taking over ("thinking" ends) cuts whatever is still playing.

Clips come from the session catalog, rendered once at setup, and bridge lines
are rendered in the background as each new plan arrives, so nothing here makes
a network call on the turn. Every entry point is best-effort and never raises
into the session.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Dict, Optional, Set

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
        emit_bridge_transcript: Callable[[str, Optional[float]], None],
        voice_on_avatar: Callable[[], bool] = lambda: False,
        background_tasks: Optional[Set[asyncio.Task]] = None,
        post_opener_pause_ms: float = 550.0,
    ) -> None:
        self._room = room_name
        self.turn_delivery = turn_delivery
        self.policy = policy
        self._bg_audio = bg_audio_getter
        self._predicted_gap_ms = predicted_gap_ms
        self._synthesize = synthesize
        self._emit_filler = emit_filler_transcript
        self._emit_bridge = emit_bridge_transcript
        self._voice_on_avatar = voice_on_avatar
        self._tasks = background_tasks if background_tasks is not None else set()
        self._post_pause_s = max(0.0, post_opener_pause_ms) / 1000.0

        #: catalog id -> FillerClip
        self.clips: Dict[str, Any] = {}
        #: The rendered bridge line for the current plan: (text, clip).
        self._bridge: Optional[tuple] = None
        self._bridge_rendering: Optional[str] = None

        self._task: Optional[asyncio.Task] = None
        self._handle = None
        self._thinking = False
        self.user_speaking = False
        self._last_learner_text: str = ""
        self.stats: Dict[str, Any] = {
            "turns": 0,
            "vocal": 0,
            "body": 0,
            "bridge": 0,
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
        """New plan: pre-render its bridge line so the next turn can play it."""
        line = plan.bridge_line
        if not line:
            return
        if (self._bridge and self._bridge[0] == line) or self._bridge_rendering == line:
            return
        self._bridge_rendering = line

        async def _render() -> None:
            try:
                clips = await self._synthesize([(line, "bridge", 0)], source="bridge")
                if clips and self._bridge_rendering == line:
                    self._bridge = (line, clips[0])
            finally:
                if self._bridge_rendering == line:
                    self._bridge_rendering = None

        spawn_background_task(
            _render(), name="opener-bridge-render", background_tasks=self._tasks
        )

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
                if self._task_pending() or self._is_playing():
                    return
                self._start_turn(created_at)
            else:
                self._thinking = False
                self._cancel()
                if new_state == "listening":
                    self.turn_delivery.end_turn()
        except Exception:  # noqa: BLE001 - must never break a session
            logger.warning("[OPENER] agent-state handler error", exc_info=True)

    def _start_turn(self, created_at) -> None:
        self.turn_delivery.begin_turn()
        self.stats["turns"] += 1
        if self._voice_on_avatar():
            turn_metrics.note_filler_decision(self._room, "skipped_video_actor")
            return
        plan = self.turn_delivery.plan
        predicted = float(self._predicted_gap_ms())
        durations = {k: float(c.duration_ms) for k, c in self.clips.items()}
        bridge = self._bridge
        decision = self.policy.decide(
            plan,
            self.catalog,
            durations,
            predicted,
            learner_text=self._last_learner_text,
            bridge_ms=float(bridge[1].duration_ms) if bridge else None,
        )
        self.policy.record(decision)
        details = {
            "fillerPredictedGapMs": int(predicted),
            "openerPlanSource": plan.source,
            "openerPlanKind": plan.opener_kind,
        }
        if not decision.plays_anything:
            self.stats["none"] += 1
            turn_metrics.note_filler_decision(self._room, decision.reason, **details)
            return
        entry = decision.entry
        self.turn_delivery.note_opener(
            OpenerRecord(
                category=decision.category,
                entry_id=entry.id if entry else None,
                kind=entry.kind if entry else None,
                spoken=entry.text if entry else None,
                bridge=bridge[0] if (decision.bridge and bridge) else None,
            )
        )
        self._task = spawn_background_task(
            self._run(decision, created_at, details),
            name="opener-play",
            background_tasks=self._tasks,
        )

    async def _run(self, decision: OpenerDecision, created_at, details: dict) -> None:
        from livekit.agents import AudioConfig

        from app.core.livekit.filler_clips import clip_audio_source

        try:
            await asyncio.sleep(max(0.0, decision.hold_ms) / 1000.0)
            if not self._can_play():
                self._withdraw()
                return
            first = True
            if decision.entry is not None:
                clip = self.clips.get(decision.entry.id)
                if clip is None:
                    self._withdraw()
                    return
                play_ts = time.time()
                self._handle = self._bg_audio().play(
                    AudioConfig(clip_audio_source(clip))
                )
                self.stats[decision.category] += 1
                if decision.entry.text:
                    self._emit_filler(decision.entry.text, play_ts)
                self._note_first_audio(
                    play_ts, created_at, clip, decision, details, kind="filler"
                )
                first = False
                await asyncio.sleep(clip.duration_ms / 1000.0)
                turn_metrics.note_filler_ended(self._room, time.time())
                if not decision.bridge:
                    return
                await asyncio.sleep(self._post_pause_s)
                if not self._can_play():
                    return
            bridge = self._bridge
            if decision.bridge and bridge is not None:
                text, clip = bridge
                self._bridge = None  # a line is heard once
                play_ts = time.time()
                self._handle = self._bg_audio().play(
                    AudioConfig(clip_audio_source(clip))
                )
                self.stats["bridge"] += 1
                self._emit_bridge(text, play_ts)
                if first:
                    self._note_first_audio(
                        play_ts, created_at, clip, decision, details, kind="interim"
                    )
                else:
                    turn_metrics.record(self._room, metadata={"openerBridge": True})
                await asyncio.sleep(clip.duration_ms / 1000.0)
                turn_metrics.note_filler_ended(self._room, time.time())
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 - must never break a session
            logger.warning("[OPENER] play error", exc_info=True)

    def _note_first_audio(
        self, play_ts, created_at, clip, decision: OpenerDecision, details, kind
    ) -> None:
        turn_metrics.note_filler_started(self._room, play_ts, kind=kind)
        lead = (play_ts - created_at) * 1000.0 if created_at is not None else None
        entry = decision.entry
        turn_metrics.note_filler_decision(
            self._room,
            "played",
            fillerLeadMs=int(lead) if lead is not None else None,
            fillerDurationMs=int(clip.duration_ms),
            fillerClipSource=clip.source,
            fillerType=entry.kind if entry else "bridge",
            openerCategory=decision.category,
            openerId=entry.id if entry else None,
            openerHoldMs=int(decision.hold_ms),
            openerBridge=bool(decision.bridge),
            **details,
        )
        logger.info(
            "[OPENER] playing %s %s (hold %.0fms, bridge=%s) for a predicted %sms gap",
            decision.category,
            entry.id if entry else "bridge",
            decision.hold_ms,
            decision.bridge,
            details.get("fillerPredictedGapMs"),
        )

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
