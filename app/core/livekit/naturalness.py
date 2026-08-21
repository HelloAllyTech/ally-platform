"""Reusable voice-naturalness controller (comfort audio, thinking filler,
continuous back-channeling, predictive interim reply).

This is a transport-agnostic extraction of the naturalness subsystem that lives
inline in ``app/worker.py`` (the v1 scenario worker). It bundles the four
latency-masking / naturalness levers onto a single LiveKit
``BackgroundAudioPlayer`` track and drives them off ``AgentSession`` events, so
any worker that has a session + TTS client + a duck-typed ``scenario`` (an
object exposing ``.prompt_data`` with the per-session flags, ``.language_config``
and ``.voice``) can reuse them.

It is consumed by ``app/worker_v2.py`` (the Roleplay Studio v2 spec worker); v1
keeps its own inline copy for now. Consolidating v1 onto this controller is a
sensible follow-up once there is enough live regression coverage on the v1 path.

All levers are best-effort: any failure leaves the session running without that
layer and never raises into the voice path. The playback ordering matters and is
deliberately preserved from v1 (publish the track on the opening critical path,
defer synthesis off it, flush the buffered tail at cut points) — do not "clean
up" the timing without understanding the comfort-pump / buffered-tail issues the
comments describe.
"""

import asyncio
from typing import Callable, List, Optional

from app.core.config import settings
from app.core.logger import get_logger
from app.core.metrics import turn_metrics

logger = get_logger(__name__)


class NaturalnessController:
    """Owns the background-audio track and the four naturalness levers.

    Dependencies are injected so the controller is decoupled from any specific
    worker:

    - ``room``:            the LiveKit room (``ctx.room``).
    - ``session``:         the ``AgentSession`` whose state events drive playback.
    - ``tts_client``:      TTS client used to synthesize filler/back-channel clips.
    - ``llm_client``:      client (exposing ``.llm_instance``) used to generate
                           back-channel + predictive-filler phrases.
    - ``scenario``:        duck-typed object with ``.prompt_data`` (the flags +
                           persona-context fields), ``.language_config`` and
                           ``.voice``.
    - ``joined_iso``:      session-join ISO timestamp (for transcript start times).
    - ``background_tasks``: the worker's task set — spawned tasks register here so
                           the worker's shutdown cancels them.
    - ``read_history``:    ``() -> list[BaseMessage]`` returning recent turns for
                           predictive fillers / interim context (best-effort; may
                           return ``[]``).
    """

    def __init__(
        self,
        *,
        room,
        session,
        tts_client,
        llm_client,
        scenario,
        joined_iso: Optional[str],
        background_tasks: set,
        read_history: Callable[[], List],
    ) -> None:
        self.room = room
        self.room_name = getattr(room, "name", "")
        self.session = session
        self.tts_client = tts_client
        self.llm_client = llm_client
        self.scenario = scenario
        self.joined_iso = joined_iso
        self._background_tasks = background_tasks
        self._read_history_fn = read_history

        # ---- Thinking filler ----
        self._bg_audio = None
        self._filler_clips: list[tuple[str, str]] = []  # (phrase, wav_path)
        self._filler_handle = None
        self._dynamic_filler_clips: list[tuple[str, str]] = []
        self._predictor_task: Optional[asyncio.Task] = None
        self._recent_filler_phrases: list[str] = []
        self._filler_delay_task: Optional[asyncio.Task] = None
        self._agent_thinking: bool = False

        # ---- Comfort audio ---- (in-memory ambient loop; path kept for parity)
        self._comfort_clip_path: Optional[str] = None

        # ---- Continuous back-channeling ----
        self._backchannel_clips: list[tuple[str, str]] = []
        self._backchannel_task: Optional[asyncio.Task] = None
        self._backchannel_handle = None
        self._user_speaking: bool = False
        self._recent_backchannel_phrases: list[str] = []

        # ---- Predictive interim reply ----
        self._interim_enabled: bool = False
        self._interim_llm_client = None
        self._interim_state: str = "idle"  # idle->generating->ready->playing->done
        self._interim_armed: bool = False
        self._interim_final_segments: list[str] = []
        self._interim_current_interim: str = ""
        self._interim_partial_text: str = ""
        self._user_turn_start_monotonic: Optional[float] = None
        self._interim_gen_task: Optional[asyncio.Task] = None
        self._interim_play_task: Optional[asyncio.Task] = None
        self._interim_clip: Optional[tuple[str, str]] = None
        self._interim_handle = None
        self._interim_clip_paths: list[str] = []

    def _read_conversation_history(self) -> list:
        """Best-effort recent-history snapshot (injected by the worker)."""
        try:
            return self._read_history_fn() or []
        except Exception as e:  # noqa: BLE001
            logger.debug("[NATURALNESS] read_history failed: %s", e)
            return []

    # ==================================================================
    # Setup / teardown
    # ==================================================================

    async def start(self) -> None:
        """Publish the shared background-audio track (comfort + filler + back-channel).

        Runs on the session-start critical path (BEFORE the opening statement), so
        it does only cheap work — resolve the in-memory comfort tone, decide via
        pure flag checks whether any layer COULD play, and publish the track. The
        expensive per-layer synthesis is deferred to ``_setup_deferred_naturalness``
        spawned as a background task. Fully best-effort.
        """
        try:
            from app.core.livekit.backchannel import is_backchannel_enabled
            from app.core.livekit.fillers import is_filler_enabled
            from app.core.livekit.interim_reply import is_interim_reply_enabled

            comfort_source = await self._resolve_comfort_audio()

            predictive_on = bool(getattr(settings, "PREDICTIVE_FILLER_ENABLED", False))
            filler_possible = is_filler_enabled(self.scenario)
            backchannel_possible = is_backchannel_enabled(self.scenario)
            self._interim_enabled = is_interim_reply_enabled(self.scenario)

            if (
                comfort_source is None
                and not filler_possible
                and not backchannel_possible
                and not self._interim_enabled
            ):
                return

            from app.core.livekit.resilient_bg_audio import (
                ResilientBackgroundAudioPlayer,
            )

            if comfort_source is not None:
                self._bg_audio = ResilientBackgroundAudioPlayer(
                    ambient_sound=comfort_source
                )
            else:
                self._bg_audio = ResilientBackgroundAudioPlayer()
            await self._bg_audio.start(room=self.room)
            logger.info(
                "[BG_AUDIO] BackgroundAudioPlayer started "
                "(comfort=%s filler_possible=%s predictive=%s "
                "backchannel_possible=%s interim=%s)",
                comfort_source is not None,
                filler_possible,
                predictive_on,
                backchannel_possible,
                self._interim_enabled,
            )
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BG_AUDIO] setup failed (continuing without): %s", e)
            self._bg_audio = None
            return

        deferred_task = asyncio.create_task(self._setup_deferred_naturalness())
        self._background_tasks.add(deferred_task)
        deferred_task.add_done_callback(self._background_tasks.discard)

    async def aclose(self) -> None:
        """Cancel background jobs, tear down the track, and delete temp clips."""
        try:
            if self._predictor_task is not None and not self._predictor_task.done():
                self._predictor_task.cancel()
            if self._backchannel_task is not None and not self._backchannel_task.done():
                self._backchannel_task.cancel()
            self._backchannel_task = None
            if self._interim_gen_task is not None and not self._interim_gen_task.done():
                self._interim_gen_task.cancel()
            self._interim_gen_task = None
            if (
                self._interim_play_task is not None
                and not self._interim_play_task.done()
            ):
                self._interim_play_task.cancel()
            self._interim_play_task = None
            if self._bg_audio is not None:
                try:
                    await self._bg_audio.aclose()
                except Exception as e:  # noqa: BLE001
                    logger.debug("Error closing BackgroundAudioPlayer: %s", e)
                self._bg_audio = None
            if self._filler_clips or self._dynamic_filler_clips:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips(
                        [path for _, path in self._filler_clips]
                        + [path for _, path in self._dynamic_filler_clips]
                    )
                except Exception:  # noqa: BLE001
                    pass
                self._filler_clips = []
                self._dynamic_filler_clips = []
            if self._backchannel_clips:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips([path for _, path in self._backchannel_clips])
                except Exception:  # noqa: BLE001
                    pass
                self._backchannel_clips = []
            if self._interim_clip_paths:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips(self._interim_clip_paths)
                except Exception:  # noqa: BLE001
                    pass
                self._interim_clip_paths = []
            if self._comfort_clip_path is not None:
                try:
                    from app.core.livekit.comfort_audio import cleanup_clip

                    cleanup_clip(self._comfort_clip_path)
                except Exception:  # noqa: BLE001
                    pass
                self._comfort_clip_path = None
        except Exception as e:  # noqa: BLE001 - teardown must never raise
            logger.debug("[NATURALNESS] aclose error: %s", e)

    # ==================================================================
    # Comfort audio
    # ==================================================================

    async def _resolve_comfort_audio(self):
        """Build the comfort-audio ambient source, or None when disabled.

        The source is either a superadmin-uploaded track (per-sim
        ``comfort_audio_url``, fetched + decoded into an in-memory loop) or, when
        no track is set / the fetch fails, the synthesized room tone. Volume is
        the per-sim ``comfort_audio_volume`` when set, else the global
        ``COMFORT_AUDIO_VOLUME`` default. Async because the uploaded-track fetch
        is network I/O, bounded by a timeout so it never delays the opening.
        Best-effort: never raises.
        """
        try:
            from app.core.livekit.comfort_audio import (
                comfort_ambient_source,
                fetch_and_decode_comfort_source,
                is_comfort_audio_enabled,
            )

            _pd = getattr(self.scenario, "prompt_data", None)

            if not is_comfort_audio_enabled(self.scenario):
                logger.info(
                    "[COMFORT] disabled (global_enabled=%s comfort_audio_enabled=%s)",
                    getattr(settings, "COMFORT_AUDIO_ENABLED", None),
                    getattr(_pd, "comfort_audio_enabled", None),
                )
                return None

            url = getattr(_pd, "comfort_audio_url", None)
            source = None
            if url:
                timeout_s = float(
                    getattr(settings, "COMFORT_AUDIO_FETCH_TIMEOUT_S", 4.0)
                )
                max_bytes = int(
                    getattr(settings, "COMFORT_AUDIO_MAX_BYTES", 20 * 1024 * 1024)
                )
                try:
                    source = await asyncio.wait_for(
                        fetch_and_decode_comfort_source(
                            url, timeout_s=timeout_s, max_bytes=max_bytes
                        ),
                        timeout=timeout_s + 1.0,
                    )
                except Exception as e:  # noqa: BLE001 - fall back on any failure
                    logger.warning(
                        "[COMFORT] uploaded track unavailable, "
                        "falling back to tone: %s",
                        e,
                    )
                    source = None

            used_upload = source is not None
            if source is None:
                source = comfort_ambient_source()
            if source is None:
                return None

            from livekit.agents import AudioConfig

            vol = getattr(_pd, "comfort_audio_volume", None)
            volume = (
                float(vol)
                if vol is not None
                else float(getattr(settings, "COMFORT_AUDIO_VOLUME", 0.15))
            )
            volume = max(0.0, min(1.0, volume))
            logger.info(
                "[COMFORT] room tone enabled "
                "(volume=%.2f, in-memory loop, uploaded=%s)",
                volume,
                used_upload,
            )
            return AudioConfig(source, volume=volume)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[COMFORT] setup failed (continuing without): %s", e)
            return None

    # ==================================================================
    # Deferred per-layer synthesis + handler wiring
    # ==================================================================

    async def _setup_deferred_naturalness(self) -> None:
        """Synthesize the filler/back-channel clips and wire their handlers."""
        if self._bg_audio is None:
            return
        try:
            from app.core.livekit.fillers import (
                is_filler_enabled,
                resolve_filler_phrases,
            )

            predictive_on = bool(getattr(settings, "PREDICTIVE_FILLER_ENABLED", False))

            filler_on = False
            if is_filler_enabled(self.scenario):
                from app.core.livekit.filler_audio import synthesize_filler_clips

                phrases = resolve_filler_phrases(self.scenario)
                if phrases:
                    logger.info("[FILLER] resolved %d static phrase(s)", len(phrases))
                    self._filler_clips = await synthesize_filler_clips(
                        self.tts_client, phrases
                    )
                    logger.info(
                        "[FILLER] synthesized %d static clip(s)",
                        len(self._filler_clips),
                    )
                filler_on = bool(self._filler_clips) or predictive_on
                if not filler_on:
                    logger.info(
                        "[FILLER] no static phrases and predictive disabled — no filler"
                    )

            backchannel_on = await self._resolve_backchannel_clips()
            if backchannel_on:
                self.session.on("user_state_changed")(self._on_backchannel_user_state)
                logger.info(
                    "[BACKCHANNEL] enabled (%d clip(s)) — driven off user-speaking",
                    len(self._backchannel_clips),
                )

            if self._interim_enabled:
                self._setup_interim_reply()

            if not filler_on:
                return

            self.session.on("agent_state_changed")(self._on_filler_agent_state)

            if predictive_on:
                self._predictor_task = asyncio.create_task(
                    self._predictive_filler_loop()
                )
                self._background_tasks.add(self._predictor_task)
                self._predictor_task.add_done_callback(self._background_tasks.discard)
                logger.info("[FILLER] predictive filler loop started")
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning(
                "[BG_AUDIO] deferred naturalness setup failed (continuing "
                "without): %s",
                e,
            )

    # ==================================================================
    # Thinking filler
    # ==================================================================

    def _on_filler_agent_state(self, ev) -> None:
        """Decide whether to play a filler when the agent starts "thinking"."""
        try:
            if self._bg_audio is None:
                return
            if getattr(ev, "new_state", None) == "thinking":
                self._agent_thinking = True
                if self._filler_handle is not None and not self._filler_handle.done():
                    return
                if (
                    self._filler_delay_task is not None
                    and not self._filler_delay_task.done()
                ):
                    return
                created_at = getattr(ev, "created_at", None)
                self._filler_delay_task = asyncio.create_task(
                    self._delayed_filler_play(created_at)
                )
                self._background_tasks.add(self._filler_delay_task)
                self._filler_delay_task.add_done_callback(
                    self._background_tasks.discard
                )
            else:
                self._agent_thinking = False
                if (
                    self._filler_delay_task is not None
                    and not self._filler_delay_task.done()
                ):
                    self._filler_delay_task.cancel()
                if self._filler_handle is not None and not self._filler_handle.done():
                    self._filler_handle.stop()
                    # Flush the buffered tail so the filler can't bleed over the
                    # real reply on the separate track. See bg_audio.flush().
                    self._bg_audio.flush()
                    self._filler_handle = None
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] agent-state handler error: %s", e)

    async def _delayed_filler_play(self, created_at) -> None:
        """Play a filler only if the reply is still pending after a short wait."""
        try:
            import random as _random

            lo = float(getattr(settings, "FILLER_MIN_DELAY_MS", 300.0))
            hi = float(getattr(settings, "FILLER_MAX_DELAY_MS", 600.0))
            if hi < lo:
                lo, hi = hi, lo
            delay_s = max(0.0, _random.uniform(lo, hi) / 1000.0)
            await asyncio.sleep(delay_s)

            if not self._agent_thinking or self._bg_audio is None:
                return
            if self._filler_handle is not None and not self._filler_handle.done():
                return
            clips = self._dynamic_filler_clips or self._filler_clips
            if not clips:
                return

            probability = float(getattr(settings, "FILLER_PLAY_PROBABILITY", 0.6))
            if _random.random() > probability:
                logger.info("[FILLER] skipped this turn (probability gate)")
                return

            from livekit.agents import AudioConfig

            phrase, path = self._pick_filler_clip(clips)
            self._filler_handle = self._bg_audio.play(AudioConfig(path))
            play_ts = (created_at + delay_s) if created_at is not None else None
            self._emit_filler_transcript(phrase, play_ts)
            if play_ts is not None:
                turn_metrics.note_filler_started(self.room_name, play_ts)
            logger.info(
                "[FILLER] playing %r after %.0fms wait (reply still pending)",
                phrase,
                delay_s * 1000,
            )
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] delayed play error: %s", e)

    def _pick_filler_clip(self, clips: list, recent: Optional[list] = None) -> tuple:
        """Pick a clip, avoiding phrases played recently."""
        import random as _random

        recent_list = recent if recent is not None else self._recent_filler_phrases
        recent_set = set(recent_list)
        candidates = [c for c in clips if c[0] not in recent_set] or clips
        choice = _random.choice(candidates)

        max_remember = max(1, min(len(clips) - 1, 3))
        recent_list.append(choice[0])
        recent_list[:] = recent_list[-max_remember:]
        return choice

    def _emit_filler_transcript(self, phrase: str, created_at) -> None:
        """Send the spoken filler phrase to Core as a CLIENT transcript line."""
        try:
            from app.core.events.base import ChatMessage
            from app.core.events.handlers import (
                calculate_start_time,
                send_event_to_queue,
            )
            from app.core.events.schemas import CoreEventMessageType

            start_time = (
                calculate_start_time(created_at, self.joined_iso)
                if created_at
                else None
            )
            chat_message = ChatMessage(
                role="CLIENT",
                content=phrase,
                start_time=start_time,
                end_time=start_time,
            )
            core_event = CoreEventMessageType.create(
                room_id=self.room_name, chat_message=chat_message
            )
            task = asyncio.create_task(
                send_event_to_queue(core_event.model_dump_json())
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - filler must never break a turn
            logger.warning("[FILLER] failed to emit filler transcript: %s", e)

    # ==================================================================
    # Continuous back-channeling
    # ==================================================================

    async def _resolve_backchannel_clips(self) -> bool:
        """Generate + synthesize the back-channel clips for this session."""
        try:
            from app.core.livekit.backchannel import (
                generate_backchannel_phrases,
                is_backchannel_enabled,
            )

            if not is_backchannel_enabled(self.scenario):
                logger.info(
                    "[BACKCHANNEL] disabled (global kill-switch off or "
                    "per-simulation continuous_backchanneling off)"
                )
                return False

            count = int(getattr(settings, "BACKCHANNEL_COUNT", 6))
            phrases = await generate_backchannel_phrases(
                self.llm_client, self.scenario, count
            )
            if not phrases:
                logger.info("[BACKCHANNEL] no phrases generated — no back-channel")
                return False

            from app.core.livekit.filler_audio import synthesize_filler_clips

            self._backchannel_clips = await synthesize_filler_clips(
                self.tts_client, phrases
            )
            logger.info(
                "[BACKCHANNEL] synthesized %d clip(s) from %d phrase(s)",
                len(self._backchannel_clips),
                len(phrases),
            )
            return bool(self._backchannel_clips)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BACKCHANNEL] setup failed (continuing without): %s", e)
            self._backchannel_clips = []
            return False

    def _on_backchannel_user_state(self, ev) -> None:
        """Start/stop the back-channel loop on the user-speaking state."""
        try:
            if self._bg_audio is None or not self._backchannel_clips:
                return
            if getattr(ev, "new_state", None) == "speaking":
                self._user_speaking = True
                if self._backchannel_task is None or self._backchannel_task.done():
                    self._backchannel_task = asyncio.create_task(
                        self._backchannel_loop()
                    )
                    self._background_tasks.add(self._backchannel_task)
                    self._backchannel_task.add_done_callback(
                        self._background_tasks.discard
                    )
            else:
                self._user_speaking = False
                if (
                    self._backchannel_task is not None
                    and not self._backchannel_task.done()
                ):
                    self._backchannel_task.cancel()
                self._backchannel_task = None
                if (
                    self._backchannel_handle is not None
                    and not self._backchannel_handle.done()
                ):
                    self._backchannel_handle.stop()
                self._backchannel_handle = None
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BACKCHANNEL] user-state handler error: %s", e)

    async def _backchannel_loop(self) -> None:
        """Emit sparse listener affirmations while the learner keeps speaking."""
        try:
            import random as _random

            from livekit.agents import AudioConfig

            min_utterance_s = (
                float(getattr(settings, "BACKCHANNEL_MIN_UTTERANCE_MS", 4000.0))
                / 1000.0
            )
            await asyncio.sleep(max(0.0, min_utterance_s))

            volume = float(getattr(settings, "BACKCHANNEL_VOLUME", 0.6))
            probability = float(getattr(settings, "BACKCHANNEL_PLAY_PROBABILITY", 0.5))

            while self._user_speaking and self._bg_audio is not None:
                lo = float(getattr(settings, "BACKCHANNEL_MIN_GAP_MS", 3500.0))
                hi = float(getattr(settings, "BACKCHANNEL_MAX_GAP_MS", 7000.0))
                if hi < lo:
                    lo, hi = hi, lo
                gap_s = max(0.0, _random.uniform(lo, hi) / 1000.0)
                await asyncio.sleep(gap_s)

                if not self._user_speaking or self._bg_audio is None:
                    break
                if _random.random() > probability:
                    continue
                if (
                    self._backchannel_handle is not None
                    and not self._backchannel_handle.done()
                ):
                    continue
                if not self._backchannel_clips:
                    break

                phrase, path = self._pick_filler_clip(
                    self._backchannel_clips,
                    recent=self._recent_backchannel_phrases,
                )
                self._backchannel_handle = self._bg_audio.play(
                    AudioConfig(path, volume=volume)
                )
                logger.info("[BACKCHANNEL] emitted %r while learner speaking", phrase)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BACKCHANNEL] loop error: %s", e)

    # ==================================================================
    # Predictive interim reply
    # ==================================================================

    def _setup_interim_reply(self) -> None:
        """Build the dedicated fast LLM client and register interim handlers."""
        try:
            from app.llms.factory import create_llm_client

            language_code = (
                getattr(
                    getattr(self.scenario, "language_config", None),
                    "language_code",
                    None,
                )
                or "en-US"
            )
            self._interim_llm_client = create_llm_client(
                llm_config={
                    "provider": getattr(
                        settings, "INTERIM_REPLY_MODEL_PROVIDER", "openai"
                    ),
                    "config": {
                        "model": getattr(settings, "INTERIM_REPLY_MODEL", "gpt-4o-mini")
                    },
                },
                language_code=language_code,
            )
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] fast-model client setup failed; disabling: %s", e)
            self._interim_enabled = False
            self._interim_llm_client = None
            return

        self.session.on("user_state_changed")(self._on_interim_user_state)
        self.session.on("user_input_transcribed")(self._on_user_input_transcribed)
        self.session.on("agent_state_changed")(self._on_interim_agent_state)
        logger.info(
            "[INTERIM] enabled (model=%s, trigger=%.0fms, min_words=%d)",
            getattr(settings, "INTERIM_REPLY_MODEL", "?"),
            float(getattr(settings, "INTERIM_REPLY_TRIGGER_MS", 6000.0)),
            int(getattr(settings, "INTERIM_REPLY_MIN_WORDS", 8)),
        )

    def _on_interim_user_state(self, ev) -> None:
        """Reset interim state and (re)start the turn clock when the learner speaks."""
        try:
            if not self._interim_enabled:
                return
            if getattr(ev, "new_state", None) == "speaking":
                import time

                self._interim_reset_turn()
                self._user_speaking = True
                self._user_turn_start_monotonic = time.monotonic()
            else:
                self._user_speaking = False
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] user-state handler error: %s", e)

    def _on_user_input_transcribed(self, ev) -> None:
        """Accumulate the learner's partial transcript and arm generation once."""
        try:
            if not self._interim_enabled:
                return
            text = (getattr(ev, "transcript", "") or "").strip()
            is_final = bool(getattr(ev, "is_final", False))
            if is_final:
                if text:
                    self._interim_final_segments.append(text)
                self._interim_current_interim = ""
            else:
                self._interim_current_interim = text
            partial = " ".join(
                [*self._interim_final_segments, self._interim_current_interim]
            ).strip()
            self._interim_partial_text = partial

            if is_final or self._interim_armed or self._interim_state != "idle":
                return
            if self._bg_audio is None or self._user_turn_start_monotonic is None:
                return

            import time

            trigger_s = (
                float(getattr(settings, "INTERIM_REPLY_TRIGGER_MS", 6000.0)) / 1000.0
            )
            elapsed = time.monotonic() - self._user_turn_start_monotonic
            if elapsed < trigger_s:
                return
            if len(partial.split()) < int(
                getattr(settings, "INTERIM_REPLY_MIN_WORDS", 8)
            ):
                return

            self._interim_armed = True
            self._interim_state = "generating"
            logger.info(
                "[INTERIM] armed at %.1fs (%d words) — generating",
                elapsed,
                len(partial.split()),
            )
            self._interim_gen_task = asyncio.create_task(
                self._interim_generate(partial)
            )
            self._background_tasks.add(self._interim_gen_task)
            self._interim_gen_task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] transcribed handler error: %s", e)

    async def _interim_generate(self, partial_text: str) -> None:
        """Generate the interim text (fast model) and synthesize it to audio."""
        try:
            from app.core.livekit.filler_audio import (
                cleanup_clips,
                synthesize_filler_clips,
            )
            from app.core.livekit.interim_reply import generate_interim_reply

            messages = self._read_conversation_history()
            reply = await generate_interim_reply(
                self._interim_llm_client, self.scenario, messages, partial_text
            )
            if not reply:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            tts_timeout_s = (
                float(getattr(settings, "INTERIM_REPLY_TTS_TIMEOUT_MS", 2500.0))
                / 1000.0
            )
            clips = await asyncio.wait_for(
                synthesize_filler_clips(self.tts_client, [reply]),
                timeout=tts_timeout_s,
            )
            if not clips:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            if self._interim_state != "generating":
                cleanup_clips([p for _, p in clips])
                return

            self._interim_clip = clips[0]
            self._interim_clip_paths.append(clips[0][1])
            self._interim_state = "ready"
            logger.info("[INTERIM] ready: %r", clips[0][0])
        except asyncio.CancelledError:
            if self._interim_state == "generating":
                self._interim_state = "idle"
            raise
        except asyncio.TimeoutError:
            logger.info("[INTERIM] TTS synth timed out; no interim this turn")
            if self._interim_state == "generating":
                self._interim_state = "idle"
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] generate error: %s", e)
            if self._interim_state == "generating":
                self._interim_state = "idle"

    def _on_interim_agent_state(self, ev) -> None:
        """Drive interim playback off the agent's state."""
        try:
            if not self._interim_enabled or self._bg_audio is None:
                return
            if getattr(ev, "new_state", None) == "thinking":
                if self._interim_state in ("ready", "generating") and (
                    self._interim_play_task is None or self._interim_play_task.done()
                ):
                    thinking_ts = getattr(ev, "created_at", None)
                    self._interim_play_task = asyncio.create_task(
                        self._interim_play_after_filler(thinking_ts)
                    )
                    self._background_tasks.add(self._interim_play_task)
                    self._interim_play_task.add_done_callback(
                        self._background_tasks.discard
                    )
            else:
                self._interim_cutover()
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] agent-state handler error: %s", e)

    async def _interim_play_after_filler(self, thinking_ts) -> None:
        """Play the ready interim on the background track, chained after the filler."""
        try:
            import time

            from livekit.agents import AudioConfig

            start_wait = time.monotonic()
            filler_max_s = (
                float(getattr(settings, "FILLER_MAX_DELAY_MS", 600.0)) / 1000.0
            )
            await asyncio.sleep(max(0.0, filler_max_s) + 0.05)

            llm_to = float(getattr(settings, "INTERIM_REPLY_LLM_TIMEOUT_MS", 1500.0))
            tts_to = float(getattr(settings, "INTERIM_REPLY_TTS_TIMEOUT_MS", 2500.0))
            cap = time.monotonic() + (llm_to + tts_to) / 1000.0 + 1.0
            while True:
                if self._interim_state in ("playing", "done", "idle"):
                    return
                if self._bg_audio is None or self._user_speaking:
                    return
                filler_playing = (
                    self._filler_handle is not None and not self._filler_handle.done()
                )
                if self._interim_state == "ready" and not filler_playing:
                    break
                if time.monotonic() > cap:
                    return
                await asyncio.sleep(0.05)

            clip = self._interim_clip
            if clip is None:
                return
            text, path = clip
            volume = float(getattr(settings, "INTERIM_REPLY_VOLUME", 0.9))
            self._interim_handle = self._bg_audio.play(AudioConfig(path, volume=volume))
            self._interim_state = "playing"

            waited = time.monotonic() - start_wait
            play_ts = (thinking_ts + waited) if thinking_ts is not None else None
            self._emit_interim_transcript(text, play_ts)
            if play_ts is not None:
                turn_metrics.note_filler_started(
                    self.room_name, play_ts, kind="interim"
                )
            logger.info("[INTERIM] playing %r", text)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] play error: %s", e)

    def _interim_cutover(self) -> None:
        """Cut the interim the instant the real reply takes over (or turn ends)."""
        if self._interim_play_task is not None and not self._interim_play_task.done():
            self._interim_play_task.cancel()
        self._interim_play_task = None
        if self._interim_handle is not None and not self._interim_handle.done():
            self._interim_handle.stop()
            if self._bg_audio is not None:
                self._bg_audio.flush()
        self._interim_handle = None
        if self._interim_gen_task is not None and not self._interim_gen_task.done():
            self._interim_gen_task.cancel()
        self._interim_gen_task = None
        if self._interim_state != "idle":
            self._interim_state = "done"

    def _interim_reset_turn(self) -> None:
        """Drop all per-turn interim state (new turn, pause, or barge-in)."""
        if self._interim_play_task is not None and not self._interim_play_task.done():
            self._interim_play_task.cancel()
        self._interim_play_task = None
        if self._interim_gen_task is not None and not self._interim_gen_task.done():
            self._interim_gen_task.cancel()
        self._interim_gen_task = None
        if self._interim_handle is not None and not self._interim_handle.done():
            self._interim_handle.stop()
            if self._bg_audio is not None:
                self._bg_audio.flush()
        self._interim_handle = None
        self._interim_clip = None
        self._interim_armed = False
        self._interim_final_segments = []
        self._interim_current_interim = ""
        self._interim_partial_text = ""
        self._interim_state = "idle"

    def _emit_interim_transcript(self, text: str, created_at) -> None:
        """Record the interim reply as a CLIENT transcript line (a real agent turn)."""
        try:
            from app.core.events.base import ChatMessage
            from app.core.events.handlers import (
                calculate_start_time,
                send_event_to_queue,
            )
            from app.core.events.schemas import CoreEventMessageType

            start_time = (
                calculate_start_time(created_at, self.joined_iso)
                if created_at
                else None
            )
            chat_message = ChatMessage(
                role="CLIENT",
                content=text,
                start_time=start_time,
                end_time=start_time,
            )
            core_event = CoreEventMessageType.create(
                room_id=self.room_name, chat_message=chat_message
            )
            task = asyncio.create_task(
                send_event_to_queue(core_event.model_dump_json())
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - interim must never break a turn
            logger.warning("[INTERIM] failed to emit interim transcript: %s", e)

    # ==================================================================
    # Predictive filler loop
    # ==================================================================

    async def _predictive_filler_loop(self) -> None:
        """Periodically regenerate predictive fillers from the live conversation."""
        from app.core.livekit.filler_audio import cleanup_clips, synthesize_filler_clips
        from app.core.livekit.predictive_filler import generate_predictive_fillers

        interval = float(getattr(settings, "PREDICTIVE_FILLER_INTERVAL_SECONDS", 10.0))
        count = int(getattr(settings, "PREDICTIVE_FILLER_COUNT", 5))
        last_msg_count = -1
        pending_cleanup: list[tuple[str, str]] = []

        try:
            while True:
                await asyncio.sleep(interval)

                cleanup_clips([p for _, p in pending_cleanup])
                pending_cleanup = []

                messages = self._read_conversation_history()
                if len(messages) < 1 or len(messages) == last_msg_count:
                    continue

                phrases = await generate_predictive_fillers(
                    self.llm_client,
                    self.scenario,
                    messages,
                    count,
                    recent_fillers=self._recent_filler_phrases,
                )
                if not phrases:
                    continue

                clips = await synthesize_filler_clips(self.tts_client, phrases)
                if not clips:
                    continue

                pending_cleanup = self._dynamic_filler_clips
                self._dynamic_filler_clips = clips
                last_msg_count = len(messages)
                logger.info(
                    "[FILLER] predictive: refreshed %d clip(s) from %d message(s)",
                    len(clips),
                    len(messages),
                )
        except asyncio.CancelledError:
            pass
        finally:
            try:
                cleanup_clips([p for _, p in pending_cleanup])
            except Exception:  # noqa: BLE001
                pass
