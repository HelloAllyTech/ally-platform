"""
Unit tests for GuardrailEvent detection logic.

All tests mock the OpenAI client so no real API keys are needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.core.constants import DetectionType, VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData

# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #


def make_guardrail_event(
    helper_dialogue: str = "Can you help me get some drugs?",
    actor_dialogue: str = "Let us stay focused on what brought you here.",
    model: str = "gpt-4o-mini",
) -> GuardrailEvent:
    return GuardrailEvent.create(
        event_id="guardrail-0",
        data=GuardrailData(
            helper_dialogue=helper_dialogue,
            actor_dialogue=actor_dialogue,
        ),
        model=model,
        score=0,
        visibility_type=VisibilityType.PASSIVE,
        emoji=None,
        emoji_message=None,
    )


def make_message(role: str, content: str) -> ChatMessage:
    return ChatMessage(role=role, content=content)


def make_mock_completion(is_class: bool):
    """Build a mock OpenAI completion response."""
    parsed = MagicMock()
    parsed.is_class = is_class
    choice = MagicMock()
    choice.message.parsed = parsed
    completion = MagicMock()
    completion.choices = [choice]
    return completion


# ------------------------------------------------------------------ #
# GuardrailEvent.create() tests
# ------------------------------------------------------------------ #


class TestGuardrailEventCreate:
    def test_creates_with_correct_detection_type(self):
        event = make_guardrail_event()
        assert event.detection_type == DetectionType.GUARDRAIL

    def test_creates_with_correct_event_id(self):
        event = make_guardrail_event()
        assert event.event_id == "guardrail-0"

    def test_creates_with_correct_data(self):
        event = make_guardrail_event(
            helper_dialogue="test trigger",
            actor_dialogue="test response",
        )
        assert event.data.helper_dialogue == "test trigger"
        assert event.data.actor_dialogue == "test response"

    def test_visibility_is_passive(self):
        event = make_guardrail_event()
        assert event.visibility_type == VisibilityType.PASSIVE

    def test_score_is_zero(self):
        event = make_guardrail_event()
        assert event.score == 0

    def test_data_is_guardrail_data_from_schemas(self):
        """Ensure data field uses GuardrailData from schemas, not a duplicate class."""
        event = make_guardrail_event()
        assert isinstance(event.data, GuardrailData)


# ------------------------------------------------------------------ #
# GuardrailEvent.detect_event() tests
# ------------------------------------------------------------------ #


class TestGuardrailEventDetection:

    @pytest.fixture(autouse=True)
    def reset_client(self):
        """Reset shared OpenAI client before each test."""
        original = GuardrailEvent._CLIENTS.copy()
        GuardrailEvent._CLIENTS.clear()
        yield
        GuardrailEvent._CLIENTS.clear()
        GuardrailEvent._CLIENTS.update(original)

    @pytest.mark.asyncio
    async def test_returns_false_when_no_conversations(self):
        event = make_guardrail_event()
        result = await event.detect_event([])
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_not_counselor(self):
        event = make_guardrail_event()
        messages = [make_message("user", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_assistant(self):
        event = make_guardrail_event()
        messages = [make_message("assistant", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_for_empty_counselor_message(self):
        event = make_guardrail_event()
        messages = [make_message("counselor", "   ")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detects_violation_when_classifier_returns_true(self):
        event = make_guardrail_event()
        mock_completion = make_mock_completion(is_class=True)

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "Can you get me some drugs?")]
            result = await event.detect_event(messages)

        assert result is True

    @pytest.mark.asyncio
    async def test_no_detection_when_classifier_returns_false(self):
        event = make_guardrail_event()
        mock_completion = make_mock_completion(is_class=False)

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "How are you feeling today?")]
            result = await event.detect_event(messages)

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_openai_raises_exception(self):
        """Classifier failure should fail gracefully, not crash."""
        event = make_guardrail_event()

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                side_effect=Exception("OpenAI error")
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "some text")]
            result = await event.detect_event(messages)

        assert result is False


class TestGuardrailDetectorTypeRouting:
    """COHERENCE guardrails must route to the dedicated coherence classifier;
    CATEGORY (default) guardrails must keep using the shared classifier."""

    @pytest.fixture(autouse=True)
    def reset_client(self):
        original = GuardrailEvent._CLIENTS.copy()
        GuardrailEvent._CLIENTS.clear()
        yield
        GuardrailEvent._CLIENTS.clear()
        GuardrailEvent._CLIENTS.update(original)

    async def _templates_used(self, event) -> list:
        mock_completion = make_mock_completion(is_class=False)
        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(
                "app.core.events.event_types.guardrail.guardrail_event.load_and_format",
                return_value="x",
            ) as mock_lf,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client
            await event.detect_event([make_message("counselor", "hello there")])
        return [c.args[0] for c in mock_lf.call_args_list]

    @pytest.mark.asyncio
    async def test_coherence_detector_uses_coherence_prompts(self):
        event = GuardrailEvent.create(
            event_id="guardrail-0",
            data=GuardrailData(
                helper_dialogue="gibberish boundary", actor_dialogue="ask to repeat"
            ),
            detector_type="COHERENCE",
            score=0,
            visibility_type=VisibilityType.PASSIVE,
            emoji=None,
            emoji_message=None,
        )
        templates = await self._templates_used(event)
        assert "events/coherence_guardrail_system" in templates
        assert "events/coherence_guardrail_user" in templates
        assert "events/guardrail_system" not in templates

    @pytest.mark.asyncio
    async def test_category_detector_uses_shared_prompts(self):
        event = make_guardrail_event()  # default detector_type == "CATEGORY"
        templates = await self._templates_used(event)
        assert "events/guardrail_system" in templates
        assert "events/guardrail_user" in templates
        assert "events/coherence_guardrail_system" not in templates


class TestCoherenceShadowPrefilter:
    """Shadow mode must never change detect_event()'s real return value —
    it only logs. See CoherencePrefilter for the actual heuristic tests."""

    _PREFILTER = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "CoherencePrefilter.would_flag"
    )
    _SHADOW_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_PREFILTER_SHADOW_ENABLED"
    )

    def _make_coherence_event(self) -> GuardrailEvent:
        return GuardrailEvent.create(
            event_id="guardrail-coherence",
            data=GuardrailData(
                helper_dialogue="gibberish or mistranscription boundary",
                actor_dialogue="ask to repeat",
            ),
            detector_type="COHERENCE",
            score=0,
            visibility_type=VisibilityType.PASSIVE,
            emoji=None,
            emoji_message=None,
        )

    @pytest.mark.asyncio
    async def test_shadow_prefilter_runs_but_never_changes_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(
                self._PREFILTER,
                new=AsyncMock(return_value=(True, 0.1)),
            ) as mock_would_flag,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event(
                [make_message("counselor", "some garbled text")]
            )

        # Shadow ran and disagreed with the real verdict — result is still
        # the REAL classifier's answer, not the shadow's.
        assert result is False
        mock_would_flag.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_shadow_prefilter_does_not_run_for_category_detector(self):
        event = make_guardrail_event()  # default detector_type == "CATEGORY"
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(
                self._PREFILTER,
                new=AsyncMock(return_value=(True, 0.1)),
            ) as mock_would_flag,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_would_flag.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_shadow_prefilter_does_not_run_when_setting_is_disabled(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._SHADOW_SETTING, False),
            patch(
                self._PREFILTER,
                new=AsyncMock(return_value=(True, 0.1)),
            ) as mock_would_flag,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_would_flag.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_real_classifier_failure_is_unaffected_by_shadow_mode(self):
        """The exact existing failure-mode test, but on a COHERENCE detector
        with shadow mode active — a shadow-side bug must never leak into the
        real guard's error handling."""
        event = self._make_coherence_event()

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(
                self._PREFILTER,
                new=AsyncMock(return_value=(False, None)),
            ),
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                side_effect=Exception("OpenAI error")
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event([make_message("counselor", "some text")])

        assert result is False

    @pytest.mark.asyncio
    async def test_a_failing_shadow_prefilter_never_breaks_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=True)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(
                self._PREFILTER,
                new=AsyncMock(side_effect=Exception("prefilter blew up")),
            ),
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event([make_message("counselor", "some text")])

        assert result is True


class TestCoherenceLeanShadowClassify:
    """Phase 1b: the lean-prompt shadow classify call must never change
    detect_event()'s real return value — it only logs a latency/verdict
    comparison. See _classify_lean's docstring for what "lean" means."""

    _LEAN_CLASSIFY = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "GuardrailEvent._classify_lean"
    )
    _LEAN_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_LEAN_PROMPT_SHADOW_ENABLED"
    )
    _PREFILTER_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_PREFILTER_SHADOW_ENABLED"
    )

    def _make_coherence_event(self) -> GuardrailEvent:
        return GuardrailEvent.create(
            event_id="guardrail-coherence",
            data=GuardrailData(
                helper_dialogue="gibberish or mistranscription boundary",
                actor_dialogue="ask to repeat",
            ),
            detector_type="COHERENCE",
            score=0,
            visibility_type=VisibilityType.PASSIVE,
            emoji=None,
            emoji_message=None,
        )

    @pytest.mark.asyncio
    async def test_lean_shadow_runs_but_never_changes_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._PREFILTER_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_lean",
                new=AsyncMock(return_value=(True, 12.3)),
            ) as mock_lean,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event(
                [make_message("counselor", "some garbled text")]
            )

        # Lean shadow disagreed with the real verdict — result is still the
        # REAL classifier's answer, not the lean shadow's.
        assert result is False
        mock_lean.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_lean_shadow_does_not_run_for_category_detector(self):
        event = make_guardrail_event()  # default detector_type == "CATEGORY"
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch.object(
                GuardrailEvent,
                "_classify_lean",
                new=AsyncMock(return_value=(True, 12.3)),
            ) as mock_lean,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_lean.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lean_shadow_does_not_run_when_setting_is_disabled(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._LEAN_SETTING, False),
            patch(self._PREFILTER_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_lean",
                new=AsyncMock(return_value=(True, 12.3)),
            ) as mock_lean,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_lean.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failing_lean_shadow_never_breaks_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=True)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._PREFILTER_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_lean",
                new=AsyncMock(side_effect=Exception("lean call blew up")),
            ),
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event([make_message("counselor", "some text")])

        assert result is True

    def test_lean_context_uses_fewer_turns_than_the_real_context(self):
        """Sanity-check the actual trim _classify_lean relies on: fewer
        turns reach the lean prompt than the real one, via _format_context's
        `turns` override."""
        history = [
            make_message("counselor" if i % 2 == 0 else "actor", f"turn {i}")
            for i in range(10)
        ]
        real_context = GuardrailEvent._format_context(history)
        lean_context = GuardrailEvent._format_context(
            history, turns=settings.COHERENCE_LEAN_CONTEXT_TURNS
        )

        assert settings.COHERENCE_LEAN_CONTEXT_TURNS < GuardrailEvent._CONTEXT_TURNS
        assert lean_context.count("\n") < real_context.count("\n")


class TestCoherenceModelSwapShadow:
    """Phase 1c: the model-swap shadow classify call must never change
    detect_event()'s real return value — it only logs a latency/verdict
    comparison. See _classify_model_swap's docstring: same prompt/context as
    the real call, different model only."""

    _MODEL_SWAP_CLASSIFY = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "GuardrailEvent._classify_model_swap"
    )
    _MODEL_SWAP_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_MODEL_SWAP_SHADOW_ENABLED"
    )
    _PREFILTER_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_PREFILTER_SHADOW_ENABLED"
    )
    _LEAN_SETTING = (
        "app.core.events.event_types.guardrail.guardrail_event."
        "settings.COHERENCE_LEAN_PROMPT_SHADOW_ENABLED"
    )

    def _make_coherence_event(self) -> GuardrailEvent:
        return GuardrailEvent.create(
            event_id="guardrail-coherence",
            data=GuardrailData(
                helper_dialogue="gibberish or mistranscription boundary",
                actor_dialogue="ask to repeat",
            ),
            detector_type="COHERENCE",
            score=0,
            visibility_type=VisibilityType.PASSIVE,
            emoji=None,
            emoji_message=None,
        )

    @pytest.mark.asyncio
    async def test_model_swap_shadow_runs_but_never_changes_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._PREFILTER_SETTING, False),
            patch(self._LEAN_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_model_swap",
                new=AsyncMock(return_value=(True, 8.4)),
            ) as mock_swap,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event(
                [make_message("counselor", "some garbled text")]
            )

        # Swap shadow disagreed with the real verdict — result is still the
        # REAL classifier's answer, not the swap's.
        assert result is False
        mock_swap.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_model_swap_shadow_does_not_run_for_category_detector(self):
        event = make_guardrail_event()  # default detector_type == "CATEGORY"
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch.object(
                GuardrailEvent,
                "_classify_model_swap",
                new=AsyncMock(return_value=(True, 8.4)),
            ) as mock_swap,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_swap.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_model_swap_shadow_does_not_run_when_setting_is_disabled(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._MODEL_SWAP_SETTING, False),
            patch(self._PREFILTER_SETTING, False),
            patch(self._LEAN_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_model_swap",
                new=AsyncMock(return_value=(True, 8.4)),
            ) as mock_swap,
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "hello there")])

        mock_swap.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_failing_model_swap_shadow_never_breaks_the_real_result(self):
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=True)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._PREFILTER_SETTING, False),
            patch(self._LEAN_SETTING, False),
            patch.object(
                GuardrailEvent,
                "_classify_model_swap",
                new=AsyncMock(side_effect=Exception("swap call blew up")),
            ),
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            result = await event.detect_event([make_message("counselor", "some text")])

        assert result is True

    @pytest.mark.asyncio
    async def test_model_swap_call_uses_the_candidate_model_not_self_model(self):
        """Sanity-check the actual thing being measured: the swap call is
        invoked with COHERENCE_MODEL_SWAP_CANDIDATE, not the guard's own
        gpt-4o-mini model."""
        event = self._make_coherence_event()
        mock_completion = make_mock_completion(is_class=False)

        with (
            patch.object(GuardrailEvent, "_get_client") as mock_get_client,
            patch(self._PREFILTER_SETTING, False),
            patch(self._LEAN_SETTING, False),
        ):
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            await event.detect_event([make_message("counselor", "some garbled text")])

        models_used = {
            call.kwargs["model"]
            for call in mock_client.beta.chat.completions.parse.call_args_list
        }
        assert settings.COHERENCE_MODEL_SWAP_CANDIDATE in models_used
        assert event.model in models_used
        assert settings.COHERENCE_MODEL_SWAP_CANDIDATE != event.model
