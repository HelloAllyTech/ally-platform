import ast
import asyncio
import inspect
import types
from unittest.mock import AsyncMock, Mock

import pytest

import app.worker as worker
from app.core.agent import factory as agent_utils
from app.core.events import handlers as event_handler
from app.core.graph import agent_graph
from app.core.livekit.filler_clips import FillerClip
from app.core.livekit.filler_pool import FillerPool


@pytest.fixture(autouse=True)
def _google_stt_without_adc(monkeypatch):
    """The platform default STT is Google now, and the LiveKit Google plugin
    demands Application Default Credentials at construction — which CI has
    none of. Deepgram only needed an API key from the env, so these tests never
    had to care. Replace the plugin class, not our factory: the factory path
    these tests drive stays real."""
    monkeypatch.setattr(
        "livekit.plugins.google.STT", lambda **kwargs: Mock(name="google.STT")
    )


def _create_test_scenario(prompt_data, events=None):
    """Helper to create a proper Scenario object for tests."""
    from app.core.scenario.base import Scenario

    return Scenario(
        scenarioName="test",
        metadata={},
        events=events or [],
        trigger_events=[],
        termination_events=[],
        voice=None,
        prompt_data=prompt_data,
        language_config=None,
    )


def _create_test_envelope(scenario):
    """Helper to create a proper RoomMetadataEnvelope for tests."""
    from app.core.livekit.livekit_models import RoomMetadataEnvelope

    return RoomMetadataEnvelope(
        version="1.0",
        scenario=scenario,
    )


class TestWorker:
    # -------------------- initialize_agent_state --------------------
    def test_initialize_agent_state_updates_graph(self, monkeypatch):
        captured = {}

        def fake_update_state(config, values):
            captured["config"] = config
            captured["values"] = values

        monkeypatch.setattr(agent_graph, "update_state", fake_update_state)

        scenario = types.SimpleNamespace(events=["A", "B"])

        # Create a mock context
        class MockCtx:
            def __init__(self):
                self.room = types.SimpleNamespace(name="room-1")

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        worker_instance.scenario = scenario

        # Initialize agent state (now inlined in configure, but we can test it directly)
        agent_graph.update_state(
            {"configurable": {"thread_id": ctx.room.name}},
            values={
                "messages": [],
                "permitted_events": scenario.events,
                "events_accumulator": [],
                "new_events": [],
                "current_score": 0,
                "branching_instructions": [],
            },
        )

        assert captured["config"] == {"configurable": {"thread_id": "room-1"}}
        assert captured["values"]["permitted_events"] == ["A", "B"]
        assert captured["values"]["messages"] == []
        assert captured["values"]["events_accumulator"] == []
        assert captured["values"]["new_events"] == []
        assert captured["values"]["current_score"] == 0

    # -------------------- joined_iso initialization --------------------

    def test_joined_iso_uses_conversation_started_at_when_present(self, monkeypatch):
        """joined_iso is taken from scenario.conversation_started_at when set."""
        from app.core.agent.factory import initialize_agent_state

        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **kw: None)

        class MockCtx:
            def __init__(self):
                self.room = types.SimpleNamespace(name="room-1")

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        worker_instance.scenario = types.SimpleNamespace(
            events=[],
            conversation_started_at="2026-03-23T07:01:44.447000+00:00",
        )

        agent_joined_iso = initialize_agent_state(
            thread_id=ctx.room.name,
            scenario=worker_instance.scenario,
        )
        worker_instance.joined_iso = (
            worker_instance.scenario.conversation_started_at or agent_joined_iso
        )

        assert worker_instance.joined_iso == "2026-03-23T07:01:44.447000+00:00"

    def test_joined_iso_falls_back_to_current_time_when_absent(self, monkeypatch):
        """joined_iso falls back to initialize_agent_state return value when absent."""
        from app.core.agent.factory import initialize_agent_state

        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **kw: None)

        class MockCtx:
            def __init__(self):
                self.room = types.SimpleNamespace(name="room-1")

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        worker_instance.scenario = types.SimpleNamespace(
            events=[],
            conversation_started_at=None,
        )

        agent_joined_iso = initialize_agent_state(
            thread_id=ctx.room.name,
            scenario=worker_instance.scenario,
        )
        worker_instance.joined_iso = (
            worker_instance.scenario.conversation_started_at or agent_joined_iso
        )

        assert worker_instance.joined_iso is not None
        assert worker_instance.joined_iso == agent_joined_iso
        assert "+00:00" in worker_instance.joined_iso

    # -------------------- create_agent_session --------------------
    def test_create_agent_session_uses_expected_components(self, monkeypatch):
        created = {}

        class DummyAgentSession:
            def __init__(self, stt, tts, vad, turn_detection, **kwargs):
                self.stt = stt
                self.tts = tts
                self.vad = vad
                self.turn_detection = turn_detection
                self.endpointing_kwargs = kwargs
                created["session"] = True

        monkeypatch.setattr(worker, "AgentSession", DummyAgentSession)
        # Pin the plain-VAD path so this test deterministically asserts the
        # STT/TTS/VAD wiring (the semantic-EOU branch is covered separately in
        # the _resolve_turn_detection tests below).
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", False, raising=False
        )

        class MockCtx:
            def __init__(self):
                self.proc = types.SimpleNamespace(userdata={"vad": "VAD"})
                self.room = types.SimpleNamespace(name="room-1")

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        worker_instance.stt_client = types.SimpleNamespace(stt_instance="STT")
        worker_instance.tts_client = types.SimpleNamespace(tts_instance="TTS")

        # Call the class method
        worker_instance._create_session()

        assert created["session"] is True
        assert worker_instance.session.stt == "STT"
        assert worker_instance.session.tts == "TTS"
        assert worker_instance.session.vad == "VAD"
        assert worker_instance.session.turn_detection == "vad"
        assert worker_instance.session.endpointing_kwargs == {}

    # -------------------- _resolve_turn_detection --------------------
    def _bare_worker(self):
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(name="room-1"))
        return worker.AgentWorker(ctx)

    def test_resolve_turn_detection_no_vad_returns_none(self):
        td, kwargs = self._bare_worker()._resolve_turn_detection(None)
        assert td is None
        assert kwargs == {}

    def test_resolve_turn_detection_flag_off_uses_vad(self, monkeypatch):
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", False, raising=False
        )
        td, kwargs = self._bare_worker()._resolve_turn_detection("VAD")
        assert td == "vad"
        assert kwargs == {}

    def test_resolve_turn_detection_semantic_builds_model(self, monkeypatch):
        import livekit.plugins.turn_detector.multilingual as ml

        class FakeMultilingualModel:
            def __init__(self):
                pass

        monkeypatch.setattr(ml, "MultilingualModel", FakeMultilingualModel)
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
        )
        monkeypatch.setattr(
            worker.settings, "TURN_MIN_ENDPOINTING_DELAY", 0.4, raising=False
        )
        monkeypatch.setattr(
            worker.settings, "TURN_MAX_ENDPOINTING_DELAY", 4.0, raising=False
        )

        td, kwargs = self._bare_worker()._resolve_turn_detection("VAD")
        assert isinstance(td, FakeMultilingualModel)
        assert kwargs == {
            "min_endpointing_delay": 0.4,
            "max_endpointing_delay": 4.0,
        }

    def test_resolve_turn_detection_falls_back_when_model_unavailable(
        self, monkeypatch
    ):
        import livekit.plugins.turn_detector.multilingual as ml

        def _boom():
            raise RuntimeError("weights not downloaded")

        monkeypatch.setattr(ml, "MultilingualModel", _boom)
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
        )
        td, kwargs = self._bare_worker()._resolve_turn_detection("VAD")
        assert td == "vad"
        assert kwargs == {}

    def test_resolve_turn_detection_records_eou_build_timing(self, monkeypatch):
        # The per-job MultilingualModel() build is timed so [START_TIMING] can
        # confirm it stays cheap (it's a handle to the boot-loaded executor).
        import livekit.plugins.turn_detector.multilingual as ml

        class FakeMultilingualModel:
            def __init__(self):
                pass

        monkeypatch.setattr(ml, "MultilingualModel", FakeMultilingualModel)
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
        )
        w = self._bare_worker()
        td, kwargs = w._resolve_turn_detection("VAD")
        assert isinstance(td, FakeMultilingualModel)
        assert "eou_load_ms" in w._timing

    # ---- Configured endpointing pair (ally-be's global admin setting) ----

    def _eou_worker(self, monkeypatch, scenario=None):
        """Bare worker with a faked EOU model and known globals (0.5 / 3.0)."""
        import livekit.plugins.turn_detector.multilingual as ml

        class FakeMultilingualModel:
            def __init__(self):
                pass

        monkeypatch.setattr(ml, "MultilingualModel", FakeMultilingualModel)
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
        )
        monkeypatch.setattr(
            worker.settings, "TURN_MIN_ENDPOINTING_DELAY", 0.5, raising=False
        )
        monkeypatch.setattr(
            worker.settings, "TURN_MAX_ENDPOINTING_DELAY", 3.0, raising=False
        )
        w = self._bare_worker()
        if scenario is not None:
            w.scenario = scenario
        return w

    @staticmethod
    def _scenario(**prompt_data):
        return types.SimpleNamespace(prompt_data=types.SimpleNamespace(**prompt_data))

    def test_resolve_turn_detection_applies_scenario_pair(self, monkeypatch):
        w = self._eou_worker(
            monkeypatch,
            self._scenario(
                turn_min_endpointing_delay=0.3,
                turn_max_endpointing_delay=1.8,
            ),
        )
        _td, kwargs = w._resolve_turn_detection("VAD")
        assert kwargs == {
            "min_endpointing_delay": 0.3,
            "max_endpointing_delay": 1.8,
        }

    @pytest.mark.parametrize(
        "sim_min,sim_max",
        [
            (2.0, 0.5),  # inverted
            (1.0, 1.0),  # equal — no room for the model to modulate
            (0.0, 1.5),  # zero floor
            (-0.2, 1.5),  # negative floor
            (0.3, None),  # half-configured
            (None, 1.8),  # half-configured
            ("fast", 1.8),  # non-numeric
        ],
    )
    def test_resolve_turn_detection_rejects_bad_pair(
        self, monkeypatch, sim_min, sim_max
    ):
        """A nonsensical or half-configured pair leaves BOTH globals in place —
        never one tuned bound mixed with one default."""
        w = self._eou_worker(
            monkeypatch,
            self._scenario(
                turn_min_endpointing_delay=sim_min,
                turn_max_endpointing_delay=sim_max,
            ),
        )
        _td, kwargs = w._resolve_turn_detection("VAD")
        assert kwargs == {
            "min_endpointing_delay": 0.5,
            "max_endpointing_delay": 3.0,
        }

    def test_resolve_turn_detection_scenario_without_pair_uses_globals(
        self, monkeypatch
    ):
        w = self._eou_worker(
            monkeypatch,
            self._scenario(
                turn_min_endpointing_delay=None,
                turn_max_endpointing_delay=None,
            ),
        )
        _td, kwargs = w._resolve_turn_detection("VAD")
        assert kwargs == {
            "min_endpointing_delay": 0.5,
            "max_endpointing_delay": 3.0,
        }

    def test_resolve_turn_detection_no_scenario_uses_global(self, monkeypatch):
        import livekit.plugins.turn_detector.multilingual as ml

        class FakeMultilingualModel:
            def __init__(self):
                pass

        monkeypatch.setattr(ml, "MultilingualModel", FakeMultilingualModel)
        monkeypatch.setattr(
            worker.settings, "SEMANTIC_TURN_DETECTION_ENABLED", True, raising=False
        )
        monkeypatch.setattr(
            worker.settings, "TURN_MAX_ENDPOINTING_DELAY", 3.0, raising=False
        )
        # self.scenario stays None (bare worker, never assigned).
        td, kwargs = self._bare_worker()._resolve_turn_detection("VAD")
        assert kwargs["max_endpointing_delay"] == 3.0

    def test_eou_runner_registered_at_import(self):
        # Importing app.worker must register the multilingual EOU inference runner
        # so the worker creates + warms its inference executor at bootstrap. Without
        # it the executor is never built and turn detection silently degrades to VAD.
        from livekit.agents.inference_runner import _InferenceRunner

        assert "lk_end_of_utterance_multilingual" in _InferenceRunner.registered_runners

    # -------------------- entrypoint --------------------
    class DummyRoom:
        """Mock room object with event listener support"""

        def __init__(self, name="room-xyz"):
            self.name = name
            self._event_handlers = {}

        def on(self, event_name):
            """Decorator to register event handlers"""

            def decorator(fn):
                self._event_handlers[event_name] = fn
                return fn

            return decorator

    class DummySession:
        def __init__(self):
            self.started = False
            self.said = []
            self.handlers = {}

        def on(self, event_name):
            def decorator(fn):
                self.handlers[event_name] = fn
                return fn

            return decorator

        async def start(self, room, agent, room_input_options):
            # just capture that start was called with needed args
            self.started = True
            self.start_args = {"room": room, "agent": agent, "rio": room_input_options}

        def say(self, text):
            self.said.append(text)

            # Return a handler-like object for consistency with actual API
            class Handler:
                async def wait_for_playout(self):
                    pass

            return Handler()

    class DummyAgent:
        def __init__(self, llm=None, instructions=None, **kwargs):
            self.llm = llm
            self.instructions = instructions

    @pytest.mark.asyncio
    async def test_entrypoint_happy_path(self, monkeypatch):
        # Parse metadata -> scenario
        # Create a proper VoicePromptData object
        from app.core.scenario.base import PromptData, Scenario

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello", "hi"],
            prompt="test prompt",
        )

        # Create a proper Scenario object with empty events list
        # (events will be created by the actual code path)
        scenario = Scenario(
            scenarioName="test",
            metadata={},
            events=[],  # Empty list - events will be built from metadata in real code
            trigger_events=[],
            termination_events=[],
            voice=None,
            prompt_data=prompt_data,
            language_config=None,
        )

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        rm_md_envelope = RoomMetadataEnvelope(
            version="1.0",
            scenario=scenario,
        )

        from app.core.agent import factory as agent_utils

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )

        # Also mock RoomMetadataEnvelope.create to bypass Scenario.create()
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        # STT config
        stt_called = {}

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        def mock_create_stt_client(stt_config=None, language_code=None):
            stt_called["ok"] = True
            return MockSTTClient()

        from app.stt import factory as stt_factory

        monkeypatch.setattr(stt_factory, "create_stt_client", mock_create_stt_client)
        monkeypatch.setattr(
            agent_utils,
            "configure_stt_client",
            lambda scenario: mock_create_stt_client(),
        )

        # TTS config
        tts_called = {}

        def mock_create_tts(*a, **k):
            tts_called.setdefault("ok", True)
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        # Mock both the factory and the agent_utils module
        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )
        monkeypatch.setattr(
            agent_utils,
            "configure_stt_client",
            lambda scenario: mock_create_stt_client(),
        )
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: True
        )

        # Graph update already tested; still keep it deterministic
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)

        # Agent -> DummyAgent (also mock in agent_utils where it's imported)
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)

        # Mock AgentSession to return our dummy session
        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )

        # Conversation handler factory (just return passthrough fn)
        called_handler = {}

        def fake_handler_factory(room_id, joined_iso):
            def _h(evt):
                called_handler["called"] = True

            def _cleanup():
                pass

            return _h, _cleanup

        monkeypatch.setattr(
            event_handler, "create_conversation_handler", fake_handler_factory
        )

        # RoomInputOptions and noise cancellation
        class DummyBVC:
            def __init__(self):
                pass

        monkeypatch.setattr(worker.noise_cancellation, "BVC", DummyBVC)

        class DummyRIO:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        monkeypatch.setattr(worker, "RoomInputOptions", DummyRIO)

        # Context
        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = Ctx()

        await worker.entrypoint(ctx)

        # Assertions
        assert dummy_session.started is True
        assert len(dummy_session.said) == 1
        # handler should be registered
        assert "conversation_item_added" in dummy_session.handlers

    @pytest.mark.asyncio
    async def test_entrypoint_text_chat_runs_the_room_without_audio(self, monkeypatch):
        """A TEXT session goes through the same entrypoint as voice, but starts
        the room text-in/text-out, builds no STT/TTS, sets up no background
        audio, and still delivers the opening statement (as text)."""
        from app.core.agent import factory as agent_utils
        from app.core.livekit.livekit_models import RoomMetadataEnvelope
        from app.core.scenario.base import PromptData, Scenario

        scenario = Scenario(
            scenarioName="test",
            metadata={},
            events=[],
            trigger_events=[],
            termination_events=[],
            voice=None,
            prompt_data=PromptData(
                name="Test Client",
                age="30",
                gender="male",
                current_location="Test Location",
                opening_statements=["hey. not sure why i'm messaging"],
                prompt="test prompt",
            ),
            language_config=None,
            interaction_mode="TEXT",
        )
        envelope = RoomMetadataEnvelope(version="1.0", scenario=scenario)
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                envelope
            ),
        )

        def _must_not_build(*a, **k):
            raise AssertionError("a text chat must not build STT/TTS clients")

        monkeypatch.setattr(agent_utils, "configure_stt_client", _must_not_build)
        monkeypatch.setattr(agent_utils, "configure_tts_client", _must_not_build)
        monkeypatch.setattr(worker, "configure_stt_client", _must_not_build)
        monkeypatch.setattr(worker, "configure_tts_client", _must_not_build)
        monkeypatch.setattr(
            worker,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            worker,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )
        agent_kwargs = {}

        def _create_agent(*a, **k):
            agent_kwargs.update(k)
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(worker, "create_agent_with_adapter", _create_agent)
        monkeypatch.setattr(
            worker, "should_say_opening_statement", lambda *a, **k: True
        )
        interruption_wired = []
        monkeypatch.setattr(
            worker,
            "setup_interruption_detection",
            lambda session, room_id=None: interruption_wired.append(room_id),
        )
        bg_audio = []

        async def _bg_audio(self):
            bg_audio.append(True)

        monkeypatch.setattr(worker.AgentWorker, "_setup_background_audio", _bg_audio)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)

        class TextSession(self.DummySession):
            async def start(self, room, agent, **kwargs):
                self.started = True
                self.start_kwargs = kwargs

        session = TextSession()
        session_kwargs = {}

        def _session(**kwargs):
            session_kwargs.update(kwargs)
            return session

        monkeypatch.setattr(worker, "AgentSession", _session)

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        await worker.entrypoint(Ctx())

        assert session.started is True
        assert session_kwargs == {"user_away_timeout": None}
        room_in = session.start_kwargs["room_input_options"]
        room_out = session.start_kwargs["room_output_options"]
        assert room_in.audio_enabled is False and room_in.text_enabled is True
        assert room_out.audio_enabled is False
        assert room_out.transcription_enabled is True
        # No TTS means no audio-tag guidance in the persona prompt.
        assert agent_kwargs["tts_client"] is None
        assert bg_audio == [] and interruption_wired == []
        assert session.said == ["hey. not sure why i'm messaging"]

    @pytest.mark.asyncio
    async def test_opening_statement_playout_timeout_is_not_logged_as_error(
        self, monkeypatch, caplog
    ):
        """A stalled opener TTS is an anticipated, self-recovering condition
        (see the comment above the timeout in app/worker.py): the session
        keeps going and the client is merely told it may have heard silence.
        It must not log at ERROR, which pages like a real internal failure —
        the same over-alerting this repo already fixed for the benign Krisp
        noise-cancellation rejection (app/core/logger.py,
        BenignNoiseCancellationFilter).
        """
        from app.core.livekit.livekit_models import RoomMetadataEnvelope
        from app.core.scenario.base import PromptData, Scenario

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello", "hi"],
            prompt="test prompt",
        )

        scenario = Scenario(
            scenarioName="test",
            metadata={},
            events=[],
            trigger_events=[],
            termination_events=[],
            voice=None,
            prompt_data=prompt_data,
            language_config=None,
        )

        rm_md_envelope = RoomMetadataEnvelope(
            version="1.0",
            scenario=scenario,
        )

        monkeypatch.setattr(
            worker.settings, "OPENING_STATEMENT_PLAYOUT_TIMEOUT_S", 0.05
        )

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: True
        )
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)

        # A handler whose playout never completes, so the bounded wait in
        # entrypoint() always times out — this is what stalled opener TTS
        # looks like from the caller's side.
        class NeverPlaysOutHandler:
            async def wait_for_playout(self):
                await asyncio.sleep(10)

        class StallingSession(self.DummySession):
            def say(self, text):
                self.said.append(text)
                return NeverPlaysOutHandler()

        dummy_session = StallingSession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )

        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )

        class DummyBVC:
            def __init__(self):
                pass

        monkeypatch.setattr(worker.noise_cancellation, "BVC", DummyBVC)

        class DummyRIO:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        monkeypatch.setattr(worker, "RoomInputOptions", DummyRIO)

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = Ctx()

        with caplog.at_level("INFO"):
            await worker.entrypoint(ctx)

        timeout_records = [
            r
            for r in caplog.records
            if "Opening statement playout did not complete" in r.getMessage()
        ]
        assert timeout_records, "expected the opener-stall message to be logged"
        assert all(r.levelname != "ERROR" for r in timeout_records), (
            "opener-stall is an anticipated, self-recovering condition and "
            "must not log at ERROR severity (it would page like a real "
            "internal failure)"
        )

    @pytest.mark.asyncio
    async def test_entrypoint_tts_fallback(self, monkeypatch):
        from app.core.livekit.livekit_models import RoomMetadataEnvelope
        from app.core.scenario.base import PromptData, Scenario

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="female",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = Scenario(
            scenarioName="test",
            metadata={},
            events=[],
            trigger_events=[],
            termination_events=[],
            voice=None,
            prompt_data=prompt_data,
            language_config=None,
        )

        rm_md_envelope = RoomMetadataEnvelope(
            version="1.0",
            scenario=scenario,
        )

        from app.core.agent import factory as agent_utils

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        # STT should work fine
        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        # First call fails, second call (fallback) succeeds
        call_count = {"count": 0}
        fallback_used = {}

        def mock_create_tts(*a, **k):
            call_count["count"] += 1
            if call_count["count"] == 1:
                # First call fails
                raise RuntimeError("tts fail")
            else:
                # Fallback call succeeds
                gender = k.get("gender")
                if gender:
                    fallback_used["used"] = gender
                mock_client = Mock()
                mock_client.tts_instance = "DEFAULT_TTS"
                mock_client.set_defaults = AsyncMock()
                mock_client.get_parameter_metadata = Mock(return_value={})
                mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
                mock_client._apply_parameters_dict = Mock()
                return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)

        # Mock configure_tts_client to handle the fallback logic
        def mock_configure_tts_client(scenario):
            try:
                return mock_create_tts()
            except RuntimeError:
                return mock_create_tts(gender="female")

        monkeypatch.setattr(
            agent_utils, "configure_tts_client", mock_configure_tts_client
        )
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        await worker.entrypoint(Ctx())

        assert fallback_used["used"] == "female"

    # -------------------- prewarm --------------------
    def test_prewarm_sets_vad(self, monkeypatch):
        class DummyVAD:
            @staticmethod
            def load(activation_threshold):
                return f"VAD_THRESHOLD_{activation_threshold}"

        monkeypatch.setattr(worker.silero, "VAD", DummyVAD)

        class DummyProc:
            def __init__(self):
                self.userdata = {}

        proc = DummyProc()
        worker.prewarm(proc)

        assert proc.userdata["vad"] == "VAD_THRESHOLD_0.7"

    def test_prewarm_sets_bvc(self, monkeypatch):
        # prewarm also builds the BVC filter per process (the EOU model can't be
        # prewarmed — it needs the job context — so it's built per-job instead).
        class DummyVAD:
            @staticmethod
            def load(activation_threshold):
                return "VAD"

        monkeypatch.setattr(worker.silero, "VAD", DummyVAD)
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: "BVC")

        class DummyProc:
            def __init__(self):
                self.userdata = {}

        proc = DummyProc()
        worker.prewarm(proc)

        assert proc.userdata["vad"] == "VAD"
        assert proc.userdata["bvc"] == "BVC"
        assert "eou" not in proc.userdata  # EOU is never prewarmed

    def test_prewarm_degrades_when_bvc_fails(self, monkeypatch):
        # If BVC construction raises during prewarm, prewarm must not raise; VAD
        # still loads and session.start falls back to constructing BVC inline
        # (the "bvc" key is simply absent).
        class DummyVAD:
            @staticmethod
            def load(activation_threshold):
                return "VAD"

        def _boom(*a, **k):
            raise RuntimeError("no event loop")

        monkeypatch.setattr(worker.silero, "VAD", DummyVAD)
        monkeypatch.setattr(worker.noise_cancellation, "BVC", _boom)

        class DummyProc:
            def __init__(self):
                self.userdata = {}

        proc = DummyProc()
        worker.prewarm(proc)  # must not raise

        assert proc.userdata["vad"] == "VAD"
        assert "bvc" not in proc.userdata

    # -------------------- _arm_orphan_deadline --------------------
    @pytest.mark.asyncio
    async def test_arm_orphan_deadline_shuts_down_when_no_human(self):
        """If no human joins within the timeout window, the agent shuts down
        with the orphaned_no_human reason."""

        class MockCtx:
            def __init__(self):
                # No remote participants — simulates user never connecting.
                self.room = types.SimpleNamespace(name="room-1", remote_participants={})
                self.shutdown_calls = []

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)

        # 50ms is enough to confirm the timer fires without slowing CI.
        await worker_instance._arm_orphan_deadline(timeout=0.05)

        assert ctx.shutdown_calls == ["orphaned_no_human"]

    @pytest.mark.asyncio
    async def test_arm_orphan_deadline_does_not_shut_down_when_human_present(self):
        """If a human participant has joined before the deadline, the agent
        stays alive and does not call ctx.shutdown."""

        class MockCtx:
            def __init__(self):
                # remote_participants populated — simulates a connected user.
                self.room = types.SimpleNamespace(
                    name="room-1",
                    remote_participants={
                        "user-1": types.SimpleNamespace(identity="user-1")
                    },
                )
                self.shutdown_calls = []

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)

        await worker_instance._arm_orphan_deadline(timeout=0.05)

        assert ctx.shutdown_calls == []

    # -------------------- _shutdown_if_room_emptied_of_humans --------------------
    def test_shutdown_if_room_emptied_of_humans_shuts_down_when_last_human_leaves(
        self,
    ):
        """If the participant that just disconnected was the last human in
        the room, the agent shuts down immediately so the session finalizes
        (sends end-of-session) instead of staying ACTIVE on the backend
        until some later termination condition — reproduces "Leave" mid-
        session not letting the learner start afresh."""

        class MockCtx:
            def __init__(self):
                # No humans left — simulates the last human disconnecting.
                self.room = types.SimpleNamespace(name="room-1", remote_participants={})
                self.shutdown_calls = []

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        leaving_participant = types.SimpleNamespace(identity="user-1")

        worker_instance._shutdown_if_room_emptied_of_humans(leaving_participant)

        assert ctx.shutdown_calls == ["human_left_session"]

    def test_shutdown_if_room_emptied_of_humans_does_not_shut_down_when_human_remains(
        self,
    ):
        """If another human is still in the room, one participant leaving
        (e.g. the commissioned avatar, or one of several learners) must not
        end the session."""

        class MockCtx:
            def __init__(self):
                self.room = types.SimpleNamespace(
                    name="room-1",
                    remote_participants={
                        "user-2": types.SimpleNamespace(identity="user-2")
                    },
                )
                self.shutdown_calls = []

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        leaving_participant = types.SimpleNamespace(identity="user-1")

        worker_instance._shutdown_if_room_emptied_of_humans(leaving_participant)

        assert ctx.shutdown_calls == []

    # -------------------- publish_termination_audio --------------------
    # NOTE: publish_termination_audio was removed - termination handling
    # is now done in worker._handle_termination_in_entrypoint_context
    # These tests are kept for reference but test the new approach
    @pytest.mark.asyncio
    async def test_publish_termination_audio_success(self, monkeypatch):
        # This test is deprecated - termination audio is now handled
        # in worker._handle_termination_in_entrypoint_context
        # Keeping test structure for potential future use
        pass

    @pytest.mark.asyncio
    async def test_publish_termination_audio_handles_exception(self, monkeypatch):
        # This test is deprecated - termination audio is now handled
        # in worker._handle_termination_in_entrypoint_context
        # Keeping test structure for potential future use
        pass

    # -------------------- _setup_stall_watchdog --------------------
    @pytest.mark.asyncio
    async def test_setup_stall_watchdog_handles_generic_exception(
        self, monkeypatch, caplog
    ):
        """A generic exception during watchdog setup should be logged as a WARNING."""
        monkeypatch.setattr(
            "app.core.session_watchdog.SessionStallWatchdog",
            Mock(side_effect=ValueError("a generic error")),
        )

        class MockCtx:
            def __init__(self):
                self.room = types.SimpleNamespace(name="room-1")

        ctx = MockCtx()
        worker_instance = worker.AgentWorker(ctx)
        worker_instance.session = self.DummySession()

        with caplog.at_level("WARNING"):
            worker_instance._setup_stall_watchdog()

        assert worker_instance._stall_watchdog is None
        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.levelname == "WARNING"
        assert "[WATCHDOG] failed to arm; continuing without it" in record.message
        assert "a generic error" in str(record.exc_info)

    # -------------------- entrypoint additional tests --------------------
    @pytest.mark.asyncio
    async def test_entrypoint_stt_fallback(self, monkeypatch):
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        # STT should fail and fallback
        call_count = {"count": 0}
        fallback_used = {}

        def fake_stt_with_fallback(stt_config=None, language_code=None):
            call_count["count"] += 1
            if call_count["count"] == 1:
                raise RuntimeError("stt fail")
            else:
                fallback_used["used"] = language_code

                class MockSTTClient:
                    def __init__(self):
                        self.stt_instance = "DEFAULT_STT"

                return MockSTTClient()

        from app.stt import factory as stt_factory

        monkeypatch.setattr(stt_factory, "create_stt_client", fake_stt_with_fallback)
        monkeypatch.setattr("app.stt.create_stt_client", fake_stt_with_fallback)
        monkeypatch.setattr(agent_utils, "create_stt_client", fake_stt_with_fallback)

        # Mock configure_stt_client to properly handle the fallback
        def mock_configure_stt_client(scenario):
            language_code = (
                scenario.language_config.language_code
                if scenario and scenario.language_config
                else "en-IN"
            )
            try:
                return fake_stt_with_fallback()
            except RuntimeError:
                return fake_stt_with_fallback(language_code=language_code)

        monkeypatch.setattr(
            agent_utils, "configure_stt_client", mock_configure_stt_client
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        await worker.entrypoint(Ctx())

        # The fallback should have been used when the first call fails
        assert "used" in fallback_used and fallback_used["used"] is not None

    @pytest.mark.asyncio
    async def test_entrypoint_initializes_event_orchestrator(self, monkeypatch):
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )

        registry_init_called = {}

        # UPDATED MOCK: Now accepts agent_joined_at and score_keeper
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
                score_keeper=None,
                session_clock=None,
            ):
                registry_init_called["scenario"] = scenario
                registry_init_called["room"] = room
                registry_init_called["thread_id"] = thread_id
                self.termination_callback = termination_callback
                self.termination_message = None

            async def initialize(self):
                registry_init_called["initialized"] = True

            def is_termination_initiated(self):
                return False

        monkeypatch.setattr(worker, "EventOrchestrator", MockEventOrchestrator)

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        await worker.entrypoint(Ctx())

        assert registry_init_called["initialized"] is True
        assert registry_init_called["scenario"] == scenario
        assert registry_init_called["thread_id"] == "room-xyz"

    @pytest.mark.asyncio
    async def test_entrypoint_registers_shutdown_callback(self, monkeypatch):
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = Ctx()
        await worker.entrypoint(ctx)

        assert len(ctx._shutdown_callbacks) == 1

    @pytest.mark.asyncio
    async def test_shutdown_with_cleanup_bounds_hanging_teardown_awaits(
        self, monkeypatch
    ):
        """shutdown_with_cleanup awaits supervisor-notes and background-audio
        teardown BEFORE handing off to on_shutdown's own (already budgeted)
        drain chain — commit a94fa6b only bounded on_shutdown's own steps, not
        these. A stalled aclose() here (e.g. a slow network call tearing down
        the BVC track) used to block shutdown indefinitely, stacking on top
        of on_shutdown's ~19s budget and getting the process force-killed
        before it could persist the learner's score/memory — the exact
        "process did not exit in time, killing process" / exit code -10
        pair seen in production days after that commit's timeout bump."""
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)

        # These are bound directly into app.worker's own namespace (`from
        # app.core.events.handlers import create_shutdown_handler, ...`), so
        # unlike patching app.core.events.handlers itself, patching them here
        # actually takes effect for _register_callbacks. Stubbed to isolate
        # shutdown_with_cleanup's OWN teardown (under test) from on_shutdown's
        # separately-tested drain chain.
        async def _noop_original_shutdown_handler():
            return None

        monkeypatch.setattr(
            worker,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            worker,
            "create_shutdown_handler",
            lambda *a, **k: _noop_original_shutdown_handler,
        )
        monkeypatch.setattr(
            worker, "setup_interruption_detection", lambda session, room_id=None: None
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        # Keep the caps tiny so a bounded hang can't slow the test down — what
        # matters here is that SOME bound applies, not its exact production
        # duration. raising=False so this is a no-op pre-fix (the constants
        # don't exist yet), leaving the awaits genuinely unbounded so the
        # regression shows up as the outer wait_for's own TimeoutError below.
        monkeypatch.setattr(
            worker, "SUPERVISOR_NOTES_CLOSE_TIMEOUT", 0.05, raising=False
        )
        monkeypatch.setattr(worker, "BG_AUDIO_CLOSE_TIMEOUT", 0.05, raising=False)

        captured = {}
        RealAgentWorker = worker.AgentWorker

        class SpyAgentWorker(RealAgentWorker):
            def __init__(self, ctx):
                super().__init__(ctx)
                captured["worker"] = self

        monkeypatch.setattr(worker, "AgentWorker", SpyAgentWorker)

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = Ctx()
        await worker.entrypoint(ctx)

        w = captured["worker"]

        class HangingCloser:
            async def aclose(self):
                await asyncio.sleep(999)

        w._supervisor_notes = HangingCloser()
        w._bg_audio = HangingCloser()

        shutdown_handler = ctx._shutdown_callbacks[0]

        # Before the fix, a hanging aclose() blocks shutdown_with_cleanup
        # forever; the outer timeout here is only a test safety net so a
        # regression fails fast instead of hanging the suite.
        await asyncio.wait_for(shutdown_handler(), timeout=2.0)

        assert w._supervisor_notes is None
        assert w._bg_audio is None

    @pytest.mark.asyncio
    async def test_entrypoint_handle_termination_callback(self, monkeypatch):
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )

        registry_instance = {}

        # UPDATED MOCK: Now accepts agent_joined_at and score_keeper
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
                score_keeper=None,
                session_clock=None,
            ):
                self.termination_callback = termination_callback
                self.termination_message = "Goodbye"
                registry_instance["instance"] = self

            async def initialize(self):
                pass

            def is_termination_initiated(self):
                return False

            def get_termination_config(self, event_id):
                return types.SimpleNamespace(termination_message="Goodbye")

        monkeypatch.setattr(worker, "EventOrchestrator", MockEventOrchestrator)

        # Mock session with say method to track calls
        say_called = {}

        class MockHandler:
            async def wait_for_playout(self):
                pass

        class MockSessionWithSay:
            def __init__(self):
                self.handlers = {}

            def on(self, event_name):
                def decorator(fn):
                    self.handlers[event_name] = fn
                    return fn

                return decorator

            async def interrupt(self):
                pass

            def say(self, message, allow_interruptions=True):
                say_called["message"] = message
                return MockHandler()

            async def start(self, room, agent, room_input_options):
                pass

        dummy_session = MockSessionWithSay()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_called = False

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_called = True

        ctx = Ctx()

        # Create orchestrator instance first (matching what entrypoint does)
        mock_orchestrator = MockEventOrchestrator(
            scenario=scenario,
            termination_callback=None,  # Will be set by create_termination_handler
            room=ctx.room,
            thread_id=ctx.room.name,
        )
        registry_instance["instance"] = mock_orchestrator

        # Create worker instance for testing termination flow
        from app.worker import AgentWorker

        test_worker = AgentWorker(ctx)
        test_worker.session = dummy_session
        test_worker.scenario = scenario
        test_worker.tts_client = mock_create_tts()
        test_worker.llm_client = Mock()
        test_worker._termination_event = asyncio.Event()
        test_worker._termination_message = None

        # Create termination handler with worker (check actual signature)
        from app.core.events.handlers import create_termination_handler

        termination_handler = create_termination_handler(
            session=dummy_session, ctx=ctx, worker=test_worker
        )

        # Set orchestrator in the handler
        termination_handler.set_event_orchestrator(mock_orchestrator)

        # Update orchestrator's termination callback
        mock_orchestrator.termination_callback = termination_handler

        # Call termination handler (it will signal the worker via _termination_event)
        mock_event = types.SimpleNamespace(event_id="term-event")
        await termination_handler(mock_event)

        # Verify termination was signaled
        assert test_worker._termination_message == "Goodbye"
        assert test_worker._termination_event.is_set()

        # Now manually trigger the termination handler task
        await test_worker._handle_termination_in_entrypoint_context()

        assert say_called["message"] == "Goodbye"
        assert ctx.shutdown_called is True

    @pytest.mark.asyncio
    async def test_entrypoint_skips_opening_statement_when_termination_initiated(
        self, monkeypatch
    ):
        """Test that opening statement is skipped when termination is
        initiated during initialization."""
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            prompt="test prompt",
        )

        scenario = _create_test_scenario(prompt_data)
        rm_md_envelope = _create_test_envelope(scenario)

        from app.core.livekit.livekit_models import RoomMetadataEnvelope

        monkeypatch.setattr(
            agent_utils,
            "parse_room_metadata",
            lambda md, embedding_client=None, branching_llm_config=None: rm_md_envelope,
        )
        monkeypatch.setattr(
            RoomMetadataEnvelope,
            "create",
            lambda payload, embedding_client=None, branching_llm_config=None: (
                rm_md_envelope
            ),
        )

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"

        from app.stt import factory as stt_factory

        monkeypatch.setattr(
            stt_factory,
            "create_stt_client",
            lambda stt_config=None, language_code=None: MockSTTClient(),
        )
        monkeypatch.setattr(
            agent_utils, "configure_stt_client", lambda scenario: MockSTTClient()
        )

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            mock_client.set_defaults = AsyncMock()
            mock_client.get_parameter_metadata = Mock(return_value={})
            mock_client._validate_parameters_dict = Mock(side_effect=lambda d: d)
            mock_client._apply_parameters_dict = Mock()
            return mock_client

        from app.tts import factory as tts_factory

        monkeypatch.setattr(tts_factory, "create_tts_client", mock_create_tts)
        monkeypatch.setattr("app.tts.create_tts_client", mock_create_tts)
        monkeypatch.setattr(agent_utils, "create_tts_client", mock_create_tts)
        monkeypatch.setattr(
            agent_utils, "configure_tts_client", lambda scenario: mock_create_tts()
        )

        # UPDATED MOCK: Now accepts agent_joined_at and score_keeper
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
                score_keeper=None,
                session_clock=None,
            ):
                self.termination_callback = termination_callback
                self.termination_message = None
                self._termination_initiated = False

            async def initialize(self):
                # Simulate termination being initiated during initialization
                self._termination_initiated = True

            def is_termination_initiated(self):
                return self._termination_initiated

        monkeypatch.setattr(worker, "EventOrchestrator", MockEventOrchestrator)

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker,
            "AgentSession",
            lambda stt, tts, vad, turn_detection, **kwargs: dummy_session,
        )
        monkeypatch.setattr(worker, "Agent", self.DummyAgent)
        monkeypatch.setattr(agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(
            event_handler,
            "create_conversation_handler",
            lambda *a, **k: (lambda e: None, lambda: None),
        )
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())
        monkeypatch.setattr(
            agent_utils,
            "configure_llm_client",
            lambda scenario, branching_llm_config=None: Mock(),
        )
        monkeypatch.setattr(
            agent_utils,
            "initialize_agent_state",
            lambda thread_id, scenario: "2024-01-01T00:00:00Z",
        )

        def mock_create_agent_with_adapter(*a, **k):
            return self.DummyAgent(llm=None)

        monkeypatch.setattr(
            agent_utils, "create_agent_with_adapter", mock_create_agent_with_adapter
        )
        monkeypatch.setattr("app.core.agent.factory.Agent", self.DummyAgent)
        monkeypatch.setattr("livekit.agents.Agent", self.DummyAgent)
        monkeypatch.setattr(
            event_handler,
            "create_connection_state_handler",
            lambda *a, **k: lambda state: None,
        )
        monkeypatch.setattr(
            event_handler, "create_shutdown_handler", lambda *a, **k: lambda: None
        )
        monkeypatch.setattr(
            event_handler,
            "create_termination_handler",
            lambda *a, **k: lambda event: None,
        )
        monkeypatch.setattr(
            event_handler,
            "setup_interruption_detection",
            lambda session, room_id=None: None,
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}", id="test-job")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []
                self.shutdown_calls = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                self.shutdown_calls.append(reason)

        ctx = Ctx()
        await worker.entrypoint(ctx)

        # Opening statement should NOT be said because termination was initiated
        assert len(dummy_session.said) == 0


class TestParseMaxTimeSeconds:
    """_parse_max_time_seconds must mirror the clients' parseMaxTimeSec so the
    server backstop and the client timer agree on the limit."""

    def test_hms(self):
        assert worker._parse_max_time_seconds("00:05:00") == 300.0

    def test_full_hours(self):
        assert worker._parse_max_time_seconds("01:00:00") == 3600.0

    def test_two_parts_matches_client_h_m(self):
        # Client treats parts[0] as hours; mirror that exactly.
        assert worker._parse_max_time_seconds("05:00") == 5 * 3600.0

    def test_absent_or_zero_returns_none(self):
        assert worker._parse_max_time_seconds(None) is None
        assert worker._parse_max_time_seconds("") is None
        assert worker._parse_max_time_seconds("00:00:00") is None

    def test_invalid_returns_none(self):
        assert worker._parse_max_time_seconds("abc") is None


class _RecordingSession:
    """Minimal AgentSession stand-in that records .on() handler registrations."""

    def __init__(self):
        self.handlers = {}

    def on(self, event_name):
        def decorator(fn):
            self.handlers[event_name] = fn
            return fn

        return decorator


def _clip(phrase: str, duration_ms: float, ftype: str = "hesitation"):
    """A FillerClip with no real audio — playback is mocked in these tests."""
    return FillerClip(
        phrase=phrase, frames=[], duration_ms=duration_ms, filler_type=ftype
    )


class TestBackgroundAudioDeferral:
    """The opening statement must not wait on filler/back-channel synthesis.

    _setup_background_audio() now only resolves the (in-memory) comfort tone and
    publishes the player synchronously, then spawns _setup_deferred_naturalness()
    as a background task for the LLM call + TTS synthesis + handler wiring.
    """

    def _bg_worker(self, clips=True):
        ctx = types.SimpleNamespace(
            room=types.SimpleNamespace(name="room-1"),
            proc=types.SimpleNamespace(userdata={}),
        )
        w = worker.AgentWorker(ctx)
        w.scenario = types.SimpleNamespace(prompt_data=types.SimpleNamespace())
        w.tts_client = types.SimpleNamespace(
            tts_instance="TTS", can_create_clip_tts=lambda: clips
        )
        # What _setup_background_audio decides; set here for the tests that
        # drive _setup_deferred_naturalness directly.
        w._clip_tts_on = clips
        w.session = _RecordingSession()
        return w

    @staticmethod
    def _all_layers_on(monkeypatch):
        for target in (
            "app.core.livekit.fillers.is_filler_enabled",
            "app.core.livekit.backchannel.is_backchannel_enabled",
            "app.core.livekit.interim_reply.is_interim_reply_enabled",
        ):
            monkeypatch.setattr(target, lambda s: True)

    @staticmethod
    def _fake_player(monkeypatch):
        class FakePlayer:
            def __init__(self, ambient_sound=None):
                self.ambient_sound = ambient_sound

            async def start(self, room):
                self.room = room

        monkeypatch.setattr(
            "app.core.livekit.resilient_bg_audio.ResilientBackgroundAudioPlayer",
            FakePlayer,
        )
        return FakePlayer

    @pytest.mark.asyncio
    async def test_voice_without_clips_publishes_no_track_and_defers_nothing(
        self, monkeypatch
    ):
        """No clip TTS: filler, back-channel and interim are all off, so with no
        comfort tone there is nothing to publish and no LLM call to schedule."""
        w = self._bg_worker(clips=False)
        self._all_layers_on(monkeypatch)
        monkeypatch.setattr(w, "_resolve_comfort_audio", AsyncMock(return_value=None))
        deferred = AsyncMock()
        monkeypatch.setattr(w, "_setup_deferred_naturalness", deferred)

        await w._setup_background_audio()
        await asyncio.sleep(0)

        assert w._bg_audio is None
        assert w._interim_enabled is False
        deferred.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_voice_without_clips_keeps_the_comfort_tone(self, monkeypatch):
        w = self._bg_worker(clips=False)
        self._all_layers_on(monkeypatch)
        monkeypatch.setattr(w, "_resolve_comfort_audio", AsyncMock(return_value="TONE"))
        FakePlayer = self._fake_player(monkeypatch)
        deferred = AsyncMock()
        monkeypatch.setattr(w, "_setup_deferred_naturalness", deferred)

        await w._setup_background_audio()
        await asyncio.sleep(0)

        assert isinstance(w._bg_audio, FakePlayer)
        assert w._bg_audio.ambient_sound == "TONE"
        assert w._interim_enabled is False
        deferred.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_deferred_naturalness_makes_no_llm_calls_without_clips(
        self, monkeypatch
    ):
        w = self._bg_worker(clips=False)
        w._bg_audio = Mock()
        self._all_layers_on(monkeypatch)
        monkeypatch.setattr(worker.settings, "PREDICTIVE_FILLER_ENABLED", True)
        backchannel_llm = AsyncMock(return_value=["mm-hmm"])
        monkeypatch.setattr(
            "app.core.livekit.backchannel.generate_backchannel_phrases",
            backchannel_llm,
        )
        generate_fillers = AsyncMock(return_value=0)
        monkeypatch.setattr(w, "_generate_fillers", generate_fillers)
        setup_interim = Mock()
        monkeypatch.setattr(w, "_setup_interim_reply", setup_interim)

        await w._setup_deferred_naturalness()

        backchannel_llm.assert_not_awaited()
        generate_fillers.assert_not_awaited()
        setup_interim.assert_not_called()
        assert w.session.handlers == {}

    @pytest.mark.asyncio
    async def test_generative_voice_gets_no_clip_layers(self, monkeypatch):
        """End to end with a real client: Gemini-TTS is refused by the clip
        policy, so the worker never schedules the clip layers' LLM calls.
        (eleven_v3 is allowed clips on its own model and settings now.)"""
        from app.tts.factory import create_tts_client

        w = self._bg_worker()
        w.tts_client = create_tts_client(
            tts_config={"provider": "google", "config": {"voice_name": "Kore"}},
            language_code="en-US",
            gender="female",
        )
        self._all_layers_on(monkeypatch)
        # No bundled breath/sigh openers either, so nothing at all can play.
        monkeypatch.setattr(w, "_has_asset_openers", lambda: False)
        monkeypatch.setattr(w, "_resolve_comfort_audio", AsyncMock(return_value=None))
        deferred = AsyncMock()
        monkeypatch.setattr(w, "_setup_deferred_naturalness", deferred)

        await w._setup_background_audio()
        await asyncio.sleep(0)

        assert w._clip_tts_on is False
        assert w._bg_audio is None
        deferred.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_setup_background_audio_defers_synthesis(self, monkeypatch):
        w = self._bg_worker()
        # No comfort tone; both naturalness layers "possible" via pure flags.
        monkeypatch.setattr(w, "_resolve_comfort_audio", AsyncMock(return_value=None))
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.backchannel.is_backchannel_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.interim_reply.is_interim_reply_enabled", lambda s: False
        )

        started = {}

        class FakePlayer:
            def __init__(self, ambient_sound=None):
                started["ambient"] = ambient_sound

            async def start(self, room):
                started["room"] = room

        monkeypatch.setattr(
            "app.core.livekit.resilient_bg_audio.ResilientBackgroundAudioPlayer",
            FakePlayer,
        )

        # The expensive per-layer work must be scheduled as a task, NOT awaited
        # inline — replace it with an AsyncMock and confirm it runs afterwards.
        deferred = AsyncMock()
        monkeypatch.setattr(w, "_setup_deferred_naturalness", deferred)

        await w._setup_background_audio()

        # Player published synchronously; deferred synthesis not yet run.
        assert isinstance(w._bg_audio, FakePlayer)
        assert started["room"] is w.ctx.room
        deferred.assert_not_awaited()

        # Let the scheduled background task run.
        await asyncio.sleep(0)
        deferred.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_setup_background_audio_skips_track_when_nothing_possible(
        self, monkeypatch
    ):
        w = self._bg_worker()
        monkeypatch.setattr(w, "_resolve_comfort_audio", AsyncMock(return_value=None))
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: False
        )
        monkeypatch.setattr(
            "app.core.livekit.backchannel.is_backchannel_enabled", lambda s: False
        )
        monkeypatch.setattr(
            "app.core.livekit.interim_reply.is_interim_reply_enabled", lambda s: False
        )
        deferred = AsyncMock()
        monkeypatch.setattr(w, "_setup_deferred_naturalness", deferred)

        await w._setup_background_audio()
        await asyncio.sleep(0)

        assert w._bg_audio is None
        deferred.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_deferred_naturalness_failure_leaves_session_running(
        self, monkeypatch
    ):
        w = self._bg_worker()
        w._bg_audio = Mock()  # player already published by the sync part
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.fillers.resolve_filler_phrases", lambda s: ["um"]
        )

        def _boom(*a, **k):
            raise RuntimeError("tts down")

        monkeypatch.setattr("app.core.livekit.filler_clips.synthesize_clips", _boom)

        # Must swallow the failure — never raises into the session.
        assert await w._setup_deferred_naturalness() is None
        # Player untouched; session still usable.
        assert w._bg_audio is not None

    @pytest.mark.asyncio
    async def test_delivery_mode_renders_the_catalog_and_activates(self, monkeypatch):
        """With the delivery plan on, the catalog replaces the filler pool."""
        w = self._bg_worker()
        w._bg_audio = Mock()
        w._interim_enabled = False
        w.scenario = types.SimpleNamespace(
            prompt_data=types.SimpleNamespace(),
            language_config=types.SimpleNamespace(language_code="hi-IN"),
        )
        monkeypatch.setattr(worker.settings, "DELIVERY_PLAN_ENABLED", True)
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.fillers.resolve_filler_phrases", lambda s: []
        )

        async def _render(tts, phrases, **kwargs):
            return [_clip(p[0], 600.0) for p in phrases]

        monkeypatch.setattr("app.core.livekit.filler_clips.synthesize_clips", _render)
        monkeypatch.setattr(
            w, "_resolve_backchannel_clips", AsyncMock(return_value=False)
        )

        await w._setup_deferred_naturalness()

        assert w.turn_delivery.active is True
        assert w._opener_player is not None
        assert w._filler_pool is None  # the legacy pool is not built
        assert w._gap_predictor is not None
        # Hindi session: native-script entries only, never the English text.
        assert "हम्म।" in {c.phrase for c in w._opener_player.clips.values()}
        assert "Hmm." not in {c.phrase for c in w._opener_player.clips.values()}
        for event in (
            "agent_state_changed",
            "user_state_changed",
            "user_input_transcribed",
        ):
            assert event in w.session.handlers

    @pytest.mark.asyncio
    async def test_no_catalog_falls_back_to_the_legacy_filler(self, monkeypatch):
        """A catalog that cannot load must never leave the session with nothing."""
        w = self._bg_worker()
        w._bg_audio = Mock()
        w._interim_enabled = False
        monkeypatch.setattr(worker.settings, "DELIVERY_PLAN_ENABLED", True)
        monkeypatch.setattr(worker.settings, "PREDICTIVE_FILLER_ENABLED", False)
        monkeypatch.setattr(
            "app.core.livekit.opener_catalog.catalog_available", lambda: False
        )
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.fillers.resolve_filler_phrases", lambda s: ["um"]
        )
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips",
            AsyncMock(return_value=[_clip("um", 500.0)]),
        )
        monkeypatch.setattr(
            w, "_resolve_backchannel_clips", AsyncMock(return_value=False)
        )

        await w._setup_deferred_naturalness()

        assert w._opener_player is None
        assert w.turn_delivery.active is False
        assert w._filler_pool is not None and len(w._filler_pool) == 1

    @pytest.mark.asyncio
    async def test_deferred_naturalness_registers_handlers(self, monkeypatch):
        w = self._bg_worker()
        w._bg_audio = Mock()
        w._interim_enabled = False
        # The legacy filler path, kept behind the rollback flag.
        monkeypatch.setattr(worker.settings, "DELIVERY_PLAN_ENABLED", False)
        monkeypatch.setattr(worker.settings, "PREDICTIVE_FILLER_ENABLED", False)
        monkeypatch.setattr(
            "app.core.livekit.fillers.is_filler_enabled", lambda s: True
        )
        monkeypatch.setattr(
            "app.core.livekit.fillers.resolve_filler_phrases", lambda s: ["um"]
        )
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips",
            AsyncMock(return_value=[_clip("um", 500.0)]),
        )
        # Back-channel resolves to True (its own synthesis is exercised elsewhere).
        monkeypatch.setattr(
            w, "_resolve_backchannel_clips", AsyncMock(return_value=True)
        )

        await w._setup_deferred_naturalness()

        # Filler drives off agent "thinking"; back-channel off user "speaking".
        assert "agent_state_changed" in w.session.handlers
        assert "user_state_changed" in w.session.handlers
        # The rendered clip lands in the session pool, not a bare list.
        assert len(w._filler_pool) == 1
        assert w._filler_pool.phrases == ["um"]


class TestFillerPlaybackDecision:
    """The predicted-gap gate replaces the old fixed 300-600ms wait.

    The wait was the largest single term in the filler's lead time, and it was
    spent finding out something the session's own history already implies.
    """

    def _worker(self, monkeypatch, predicted_ms):
        ctx = types.SimpleNamespace(
            room=types.SimpleNamespace(name="room-1"),
            proc=types.SimpleNamespace(userdata={}),
        )
        w = worker.AgentWorker(ctx)
        w.scenario = types.SimpleNamespace(prompt_data=types.SimpleNamespace())
        w.session = _RecordingSession()
        w._bg_audio = Mock()
        w._filler_pool = FillerPool()
        monkeypatch.setattr(w, "_predicted_gap_ms", lambda: predicted_ms)
        return w

    def test_fast_turn_gets_no_filler(self, monkeypatch):
        w = self._worker(monkeypatch, predicted_ms=200.0)
        monkeypatch.setattr(worker.settings, "FILLER_PREDICTED_GAP_MS", 700.0)
        play, reason = w._should_play_filler(200.0)
        assert play is False
        assert reason == "skipped_fast_turn"

    def test_clearly_slow_turn_always_gets_one(self, monkeypatch):
        """Above the certainty threshold the probability gate is bypassed.

        A 2s silence is exactly the case the feature exists for; leaving it to a
        coin flip is what kept coverage near half.
        """
        w = self._worker(monkeypatch, predicted_ms=2000.0)
        monkeypatch.setattr(worker.settings, "FILLER_CERTAIN_GAP_MS", 1200.0)
        monkeypatch.setattr(worker.settings, "FILLER_PLAY_PROBABILITY", 0.0)
        play, reason = w._should_play_filler(2000.0)
        assert play is True
        assert reason == "played"

    def test_run_of_filler_turns_is_capped(self, monkeypatch):
        """However slow the turns are, hesitating before every reply reads as broken."""
        w = self._worker(monkeypatch, predicted_ms=3000.0)
        monkeypatch.setattr(worker.settings, "FILLER_MAX_CONSECUTIVE_TURNS", 3)
        w._filler_consecutive_turns = 3
        play, reason = w._should_play_filler(3000.0)
        assert play is False
        assert reason == "skipped_probability"

    def test_consecutive_run_survives_the_speaking_to_listening_event(
        self, monkeypatch
    ):
        """The run-length counter must not be undone by the turn's own trailing event.

        LiveKit's AgentState cycles listening->thinking->speaking->listening per
        turn, so _on_filler_agent_state's non-thinking branch fires twice for the
        same turn: once leaving "thinking" (where the run-length count should
        settle) and again moments later entering "listening". If the second
        firing re-ran that bookkeeping too, it would always see
        ``_filler_played_this_turn`` already reset to False by the first firing
        and zero the counter right back out — so the cap in
        ``_should_play_filler`` would never see a run long enough to trigger.
        """
        w = self._worker(monkeypatch, predicted_ms=3000.0)
        monkeypatch.setattr(worker.settings, "FILLER_MAX_CONSECUTIVE_TURNS", 3)

        def play_a_turn():
            # A filler already played earlier this turn (e.g. the early
            # trigger), so entering "thinking" here just confirms state
            # without exercising the async playback path.
            w._filler_turn_count = 1
            w._filler_played_this_turn = True
            w._on_filler_agent_state(
                types.SimpleNamespace(old_state="listening", new_state="thinking")
            )
            w._on_filler_agent_state(
                types.SimpleNamespace(old_state="thinking", new_state="speaking")
            )
            w._on_filler_agent_state(
                types.SimpleNamespace(old_state="speaking", new_state="listening")
            )

        for _ in range(3):
            play_a_turn()

        assert w._filler_consecutive_turns == 3
        play, reason = w._should_play_filler(3000.0)
        assert play is False
        assert reason == "skipped_probability"

    @pytest.mark.asyncio
    async def test_played_filler_is_credited_at_the_real_first_frame(self, monkeypatch):
        """response_latency_ms must use when audio actually started.

        The old code credited created_at + the randomized sleep — an estimate the
        metric itself could not verify.
        """
        w = self._worker(monkeypatch, predicted_ms=2000.0)
        w._agent_thinking = True
        w._filler_pool.add([FillerClip(phrase="hmm", frames=[], duration_ms=500.0)])
        monkeypatch.setattr(worker.settings, "FILLER_CONTINUATION_ENABLED", False)
        monkeypatch.setattr(w, "_emit_filler_transcript", Mock())
        started = {}
        monkeypatch.setattr(
            worker.turn_metrics,
            "note_filler_started",
            lambda room, ts, **kw: started.update(room=room, ts=ts),
        )
        decisions = {}
        monkeypatch.setattr(
            worker.turn_metrics,
            "note_filler_decision",
            lambda room, decision, **kw: decisions.update(decision=decision, **kw),
        )

        await w._play_filler(created_at=None, predicted_ms=2000.0, first=True)

        assert decisions["decision"] == "played"
        assert decisions["fillerDurationMs"] == 500
        assert started["ts"] > 0
        assert w._filler_decided.is_set()

    @pytest.mark.asyncio
    async def test_no_clips_is_recorded_not_silent(self, monkeypatch):
        """An empty pool is a distinct outcome from a fast turn, and must show."""
        w = self._worker(monkeypatch, predicted_ms=2000.0)
        w._agent_thinking = True
        decisions = {}
        monkeypatch.setattr(
            worker.turn_metrics,
            "note_filler_decision",
            lambda room, decision, **kw: decisions.update(decision=decision),
        )

        await w._play_filler(created_at=None, predicted_ms=2000.0, first=True)

        assert decisions["decision"] == "skipped_no_clips"

    @pytest.mark.asyncio
    async def test_filler_is_capped_per_turn(self, monkeypatch):
        """Two fillers can bridge a long gap; a third reads as stalling."""
        w = self._worker(monkeypatch, predicted_ms=3000.0)
        w._agent_thinking = True
        w._filler_pool.add(
            [FillerClip(phrase=f"p{i}", frames=[], duration_ms=400.0) for i in range(5)]
        )
        monkeypatch.setattr(worker.settings, "FILLER_CONTINUATION_ENABLED", False)
        monkeypatch.setattr(worker.settings, "FILLER_MAX_PER_TURN", 2)
        monkeypatch.setattr(w, "_emit_filler_transcript", Mock())
        w._filler_handle = None

        for _ in range(4):
            w._filler_handle = None
            await w._play_filler(None, 3000.0, first=False)

        assert w._filler_turn_count == 2

    @pytest.mark.asyncio
    async def test_gap_prediction_disabled_falls_back_to_fixed_wait(self, monkeypatch):
        """FILLER_GAP_PREDICTION_ENABLED=False must be a working rollback lever.

        Before prediction existed, the filler waited out FILLER_MIN/MAX_DELAY_MS
        and then checked whether the reply was still pending. Flipping the flag
        off must restore exactly that, not leave the predictor running.
        """
        w = self._worker(monkeypatch, predicted_ms=2000.0)
        monkeypatch.setattr(worker.settings, "FILLER_GAP_PREDICTION_ENABLED", False)
        monkeypatch.setattr(worker.settings, "FILLER_MIN_DELAY_MS", 300.0)
        monkeypatch.setattr(worker.settings, "FILLER_MAX_DELAY_MS", 600.0)
        monkeypatch.setattr(worker.settings, "FILLER_PLAY_PROBABILITY", 1.0)
        monkeypatch.setattr(worker.settings, "FILLER_CONTINUATION_ENABLED", False)
        w._filler_pool.add([FillerClip(phrase="hmm", frames=[], duration_ms=500.0)])
        monkeypatch.setattr(w, "_emit_filler_transcript", Mock())

        def _predictor_must_not_run():
            raise AssertionError(
                "the gap predictor must not run when "
                "FILLER_GAP_PREDICTION_ENABLED=False"
            )

        monkeypatch.setattr(w, "_predicted_gap_ms", _predictor_must_not_run)

        sleeps = []

        async def _fake_sleep(seconds):
            sleeps.append(seconds)

        monkeypatch.setattr(worker.asyncio, "sleep", _fake_sleep)

        w._on_filler_agent_state(
            types.SimpleNamespace(new_state="thinking", created_at=None)
        )
        assert len(w._background_tasks) == 1
        await next(iter(w._background_tasks))

        assert sleeps, "must wait out FILLER_MIN/MAX_DELAY_MS instead of predicting"
        assert 0.3 <= sleeps[0] <= 0.6
        assert w._filler_handle is not None
        assert w._filler_turn_count == 1


class TestStartUsesPrewarmedBVC:
    @pytest.mark.asyncio
    async def test_start_uses_prewarmed_bvc(self, monkeypatch):
        """Reuse the prewarmed instance rather than building a fresh one.

        Opt in explicitly: whether we ask for a filter at all is the gate's
        business (TestNoiseCancellationRequiresCloud), and it is off by
        default. This case only cares about which instance we hand over once
        the answer is yes.
        """
        prewarmed_bvc = object()
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        monkeypatch.setattr(worker.settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", True)

        class DummyRIO:
            def __init__(self, **kwargs):
                captured["noise_cancellation"] = kwargs.get("noise_cancellation")

        class DummySession:
            async def start(self, room, agent, room_input_options):
                self.started = True

        monkeypatch.setattr(worker, "RoomInputOptions", DummyRIO)
        # If the prewarmed instance were ignored, this fallback marker would show.
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: "FRESH_BVC")
        monkeypatch.setattr(
            worker, "setup_interruption_detection", lambda session, room_id=None: None
        )
        monkeypatch.setattr(
            worker,
            "should_say_opening_statement",
            lambda scenario, event_orchestrator: False,
        )
        monkeypatch.setattr(
            worker,
            "should_auto_start_conversation",
            lambda scenario, event_orchestrator: False,
        )

        async def _connect():
            return None

        ctx = types.SimpleNamespace(
            room=types.SimpleNamespace(name="room-1"),
            proc=types.SimpleNamespace(userdata={"bvc": prewarmed_bvc}),
            connect=_connect,
        )

        w = worker.AgentWorker(ctx)
        w.session = DummySession()
        w.agent = object()
        w.scenario = types.SimpleNamespace(
            prompt_data=types.SimpleNamespace(opening_statements=[])
        )
        w.event_orchestrator = types.SimpleNamespace(initialize=AsyncMock())
        monkeypatch.setattr(w, "_arm_orphan_deadline", AsyncMock())
        monkeypatch.setattr(w, "_arm_max_duration_enforcer", AsyncMock())
        monkeypatch.setattr(w, "_setup_background_audio", AsyncMock())

        await w.start()

        assert captured["noise_cancellation"] is prewarmed_bvc


class TestNoiseCancellationRequiresCloud:
    """Krisp BVC only runs on LiveKit Cloud.

    Against the self-hosted SFU the Rust SDK rejects the filter ("audio filter
    cannot be enabled: LiveKit Cloud is required" + "failed to initialize the
    audio filter") and the session runs without noise cancellation anyway, so
    the worker must not ask for it there.
    """

    def _prepare(self, monkeypatch, captured):
        class DummyRIO:
            def __init__(self, **kwargs):
                captured["noise_cancellation"] = kwargs.get("noise_cancellation")

        class DummySession:
            async def start(self, room, agent, room_input_options):
                self.started = True

        monkeypatch.setattr(worker, "RoomInputOptions", DummyRIO)
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: "FRESH_BVC")
        monkeypatch.setattr(
            worker, "setup_interruption_detection", lambda session, room_id=None: None
        )
        monkeypatch.setattr(
            worker,
            "should_say_opening_statement",
            lambda scenario, event_orchestrator: False,
        )
        monkeypatch.setattr(
            worker,
            "should_auto_start_conversation",
            lambda scenario, event_orchestrator: False,
        )

        async def _connect():
            return None

        ctx = types.SimpleNamespace(
            room=types.SimpleNamespace(name="room-1"),
            proc=types.SimpleNamespace(userdata={"bvc": "PREWARMED_BVC"}),
            connect=_connect,
        )

        w = worker.AgentWorker(ctx)
        w.session = DummySession()
        w.agent = object()
        w.scenario = types.SimpleNamespace(
            prompt_data=types.SimpleNamespace(opening_statements=[])
        )
        w.event_orchestrator = types.SimpleNamespace(initialize=AsyncMock())
        monkeypatch.setattr(w, "_arm_orphan_deadline", AsyncMock())
        monkeypatch.setattr(w, "_arm_max_duration_enforcer", AsyncMock())
        monkeypatch.setattr(w, "_setup_background_audio", AsyncMock())
        return w

    @pytest.mark.asyncio
    async def test_self_hosted_deployment_gets_no_filter(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://livekit.internal")
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] is None

    @pytest.mark.asyncio
    async def test_cloud_deployment_still_gets_the_filter(self, monkeypatch):
        """The URL heuristic, with an operator who has opted in.

        The opt-in is explicit here so this case keeps testing the hostname
        test rather than the shipped default of the flag (which is off — see
        test_a_cloud_hostname_alone_is_not_enough_to_ask_for_the_filter).
        """
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        monkeypatch.setattr(worker.settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", True)
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] == "PREWARMED_BVC"

    @pytest.mark.asyncio
    async def test_a_cloud_hostname_alone_is_not_enough_to_ask_for_the_filter(
        self, monkeypatch
    ):
        """The production failure that survived the job-URL fix.

        prd ran the URL-based gate from 2026-08-25 05:58Z and still logged
        "audio filter cannot be enabled: LiveKit Cloud is required" on three
        distinct rooms the next morning, so the job's media URL was passing
        the Cloud hostname test while the media plane behind it — self-hosted
        — refused Krisp. Nothing in the URL can distinguish the two, so a
        Cloud-shaped hostname must not by itself turn the filter on: the
        operator flag has to say yes too, and by default it doesn't.
        """
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        w = self._prepare(monkeypatch, captured)
        w.ctx._info = types.SimpleNamespace(url="wss://ally.livekit.cloud")

        await w.start()

        assert captured["noise_cancellation"] is None

    @pytest.mark.asyncio
    async def test_job_assigned_to_a_non_cloud_media_url_gets_no_filter(
        self, monkeypatch
    ):
        """We register with Cloud; this job's room connects somewhere else.

        The SDK connects the room to RunningJobInfo.url (job_assign.url or
        ws_url), so the registration URL saying "Cloud" proves nothing about
        the deployment that has to run the filter.
        """
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        w = self._prepare(monkeypatch, captured)
        w.ctx._info = types.SimpleNamespace(url="wss://sfu.internal")

        await w.start()

        assert captured["noise_cancellation"] is None

    @pytest.mark.asyncio
    async def test_kill_switch_off_declines_the_filter_on_cloud(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(worker.settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        monkeypatch.setattr(
            worker.settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", False
        )
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] is None


class TestEmitStartMetrics:
    """The per-session start-latency ("time to first word") emit to Core."""

    def _worker(self):
        ctx = types.SimpleNamespace(
            room=types.SimpleNamespace(name="room-1"),
            proc=types.SimpleNamespace(userdata={}),
        )
        w = worker.AgentWorker(ctx)
        w.scenario = types.SimpleNamespace(
            language_config=types.SimpleNamespace(language_code="en-IN")
        )
        return w

    @pytest.mark.asyncio
    async def test_emits_total_and_segments(self, monkeypatch):
        import json

        sent = {}
        emit = AsyncMock()
        monkeypatch.setattr(event_handler, "send_event_to_queue", emit)

        w = self._worker()
        w._timing = {
            "configure_ms": 100.4,
            "initialize_ms": 200.6,
            "connect_ms": 300.0,
            "prep_ms": 50.0,
            "opening_ms": 1200.0,
        }

        w._emit_start_metrics()
        await asyncio.sleep(0)  # let the fire-and-forget task run

        emit.assert_awaited_once()
        payload = json.loads(emit.await_args.args[0])
        assert payload["message_type"] == "start_metrics"
        assert payload["room_id"] == "room-1"
        sm = payload["data"]["start_metrics"]
        # Total = sum of the four segments (rounded), NOT including opening playout.
        assert sm["start_latency_ms"] == 100 + 201 + 300 + 50
        assert sm["configure_ms"] == 100
        assert sm["initialize_ms"] == 201
        assert sm["connect_ms"] == 300
        assert sm["prep_ms"] == 50
        assert sm["opening_playout_ms"] == 1200
        assert sm["language"] == "en-IN"
        sent["ok"] = True
        assert sent["ok"]

    @pytest.mark.asyncio
    async def test_no_emit_when_no_timing(self, monkeypatch):
        emit = AsyncMock()
        monkeypatch.setattr(event_handler, "send_event_to_queue", emit)

        w = self._worker()
        w._timing = {}  # start() bailed before any segment was measured

        w._emit_start_metrics()
        await asyncio.sleep(0)

        emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_glossary_provenance_rides_metadata(self, monkeypatch):
        import json

        emit = AsyncMock()
        monkeypatch.setattr(event_handler, "send_event_to_queue", emit)

        w = self._worker()
        w.scenario = types.SimpleNamespace(
            language_config=types.SimpleNamespace(language_code="ml-IN"),
            prompt_data=types.SimpleNamespace(
                language_glossary="## Core style\n- speak colloquially",
                glossary_sections=[{"title": "a"}, {"title": "b"}, {"title": "c"}],
                glossary_meta={
                    "versions": {"core_style": 4, "clinical_terms": 2},
                    "tier0Tokens": 381,
                },
            ),
        )
        w._timing = {"configure_ms": 10.0, "connect_ms": 20.0}

        w._emit_start_metrics()
        await asyncio.sleep(0)

        payload = json.loads(emit.await_args.args[0])
        glossary = payload["data"]["start_metrics"]["metadata"]["glossary"]
        assert glossary["tier0_chars"] == len("## Core style\n- speak colloquially")
        assert glossary["tier1_sections"] == 3
        assert glossary["versions"] == {"core_style": 4, "clinical_terms": 2}
        assert glossary["tier0_tokens"] == 381

    @pytest.mark.asyncio
    async def test_no_glossary_metadata_for_sessions_without_glossary(
        self, monkeypatch
    ):
        import json

        emit = AsyncMock()
        monkeypatch.setattr(event_handler, "send_event_to_queue", emit)

        w = self._worker()  # scenario has no prompt_data at all
        w._timing = {"configure_ms": 10.0, "connect_ms": 20.0}

        w._emit_start_metrics()
        await asyncio.sleep(0)

        payload = json.loads(emit.await_args.args[0])
        assert payload["data"]["start_metrics"]["metadata"] is None

    @pytest.mark.asyncio
    async def test_never_raises_on_emit_failure(self, monkeypatch):
        def _boom(*a, **k):
            raise RuntimeError("queue down")

        monkeypatch.setattr(event_handler, "send_event_to_queue", _boom)

        w = self._worker()
        w._timing = {"configure_ms": 10.0, "connect_ms": 20.0}

        # Must swallow the failure — a metrics emit can never break a session.
        w._emit_start_metrics()
        await asyncio.sleep(0)

    def test_send_coroutine_is_never_abandoned_without_a_running_loop(
        self, monkeypatch
    ):
        """Regression: the emit coroutine must not be left un-awaited.

        `asyncio.create_task(send_event_to_queue(payload))` builds the
        coroutine before create_task sees it. Off the loop, create_task
        raises, the broad `except Exception` logs it, and the coroutine is
        abandoned — the metric is lost and Python reports it later, from an
        unrelated test, as ``RuntimeWarning: coroutine 'send_event_to_queue'
        was never awaited``.
        """
        created = []

        async def _send(_payload):
            return None

        def _factory(payload):
            coro = _send(payload)
            created.append(coro)
            return coro

        monkeypatch.setattr(event_handler, "send_event_to_queue", _factory)

        w = self._worker()
        w._timing = {"configure_ms": 10.0, "connect_ms": 20.0}

        w._emit_start_metrics()  # sync call, no running event loop

        assert created, "no start-metrics send coroutine was built"
        abandoned = [
            c for c in created if inspect.getcoroutinestate(c) == inspect.CORO_CREATED
        ]
        assert not abandoned, (
            "start-metrics send coroutine left un-awaited — the metric is "
            "dropped and it surfaces as a RuntimeWarning"
        )


class TestDispatchEntrypoint:
    """`dispatch_entrypoint` is now a pass-through to `entrypoint`.

    It used to route by an ``engine`` marker in room metadata, sending
    roleplay_v2-marked jobs to a second runtime living in this same worker
    process. Studio v2 is gone, so there is one engine and nothing to route —
    the marker tests, the import-failure refusal and the v1-fallthrough case
    all went with it. Kept as a class so the indirection stays covered: the
    LiveKit worker options name this function, not `entrypoint`.
    """

    async def test_every_job_goes_to_the_v1_entrypoint(self, monkeypatch):
        called = {}

        async def _fake_entrypoint(ctx):
            called["ctx"] = ctx
            return "ok"

        monkeypatch.setattr(worker, "entrypoint", _fake_entrypoint)
        ctx = types.SimpleNamespace(
            job=types.SimpleNamespace(id="job-1", metadata="{}")
        )
        assert await worker.dispatch_entrypoint(ctx) == "ok"
        assert called["ctx"] is ctx


class TestPredictiveFillerLlmIsolation:
    """The predictive-filler background job used to share generate_response's
    own LLM client/connection, which a real A/B test showed inflates
    avgLlmTtftMs (~270ms) with the total generation time unaffected — the
    signature of connection contention, not a slower model. It must now use
    its own, connection-isolated client (_setup_predictive_filler_llm_client),
    built from the identical configure_llm_client() resolution so the model/
    provider/temperature never differs from the real reply's."""

    def _worker(self):
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(name="room-1"))
        return worker.AgentWorker(ctx)

    def test_builds_a_distinct_client_from_the_shared_one(self, monkeypatch):
        shared = Mock(name="shared-llm-client")
        dedicated = Mock(name="dedicated-llm-client")
        monkeypatch.setattr(worker, "configure_llm_client", lambda scenario: dedicated)

        w = self._worker()
        w.scenario = types.SimpleNamespace()
        w.llm_client = shared

        w._setup_predictive_filler_llm_client()

        assert w._predictive_filler_llm_client is dedicated
        assert w._predictive_filler_llm_client is not w.llm_client

    def test_falls_back_to_the_shared_client_on_failure(self, monkeypatch):
        shared = Mock(name="shared-llm-client")

        def _boom(scenario):
            raise RuntimeError("provider config broken")

        monkeypatch.setattr(worker, "configure_llm_client", _boom)

        w = self._worker()
        w.scenario = types.SimpleNamespace()
        w.llm_client = shared

        # Must never raise — a broken dedicated-client build can't break the session.
        w._setup_predictive_filler_llm_client()

        assert w._predictive_filler_llm_client is shared

    @pytest.mark.asyncio
    async def test_regeneration_calls_the_dedicated_client(self, monkeypatch):
        from app.core.livekit import predictive_filler as predictive_filler_module

        shared = Mock(name="shared-llm-client")
        dedicated = Mock(name="dedicated-llm-client")

        generate_mock = AsyncMock(return_value=[("hmm…", "hesitation")])
        monkeypatch.setattr(
            predictive_filler_module, "generate_predictive_fillers", generate_mock
        )
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips",
            AsyncMock(return_value=[_clip("hmm…", 400.0)]),
        )

        w = self._worker()
        w.scenario = types.SimpleNamespace()
        w.llm_client = shared
        w._predictive_filler_llm_client = dedicated
        w._filler_pool = FillerPool()
        w._read_conversation_history = Mock(return_value=["turn one"])

        await w._generate_fillers(source="exchange")

        generate_mock.assert_awaited_once()
        called_client = generate_mock.await_args.args[0]
        assert called_client is dedicated
        assert called_client is not shared

    @pytest.mark.asyncio
    @pytest.mark.parametrize("source", ["seed", "exchange", "in_turn"])
    async def test_generation_and_clips_are_attributed_to_the_room(
        self, monkeypatch, source
    ):
        """AI-cost: every filler moment runs outside the graph run, so the
        worker must hand the room to both the LLM call (thinking_filler) and
        the clip synthesis (clip_tts), or the spend lands on no session."""
        from app.core.livekit import predictive_filler as predictive_filler_module

        seen = {}

        async def fake_generate(*_a, **kw):
            seen["generate"] = kw
            return [("hmm…", "hesitation")]

        async def fake_synth(_tts, _requests, **kw):
            seen["synth"] = kw
            return [_clip("hmm…", 400.0)]

        for name in (
            "generate_seed_fillers",
            "generate_predictive_fillers",
            "generate_in_turn_fillers",
        ):
            monkeypatch.setattr(predictive_filler_module, name, fake_generate)
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips", fake_synth
        )

        w = self._worker()
        w.scenario = types.SimpleNamespace()
        w._predictive_filler_llm_client = Mock()
        w._filler_pool = FillerPool()
        w._read_conversation_history = Mock(return_value=["turn one"])
        w._tts_provider, w._tts_model = "sarvam", "bulbul:v3"

        await w._generate_fillers(source=source, partial_text="I was thinking")

        assert seen["generate"]["room_id"] == "room-1"
        assert seen["synth"]["usage_room_id"] == "room-1"
        assert seen["synth"]["usage_provider"] == "sarvam"
        assert seen["synth"]["usage_model"] == "bulbul:v3"

    @pytest.mark.asyncio
    async def test_regeneration_skips_while_pool_still_fresh(self, monkeypatch):
        """The old loop paid an LLM + 5 TTS calls every 10s regardless.

        Exchange-driven regeneration must SKIP entirely while the pool still
        holds unheard phrases — that skip is where most of the cost saving comes
        from, so it is worth pinning rather than trusting.
        """
        w = self._worker()
        w.scenario = types.SimpleNamespace()
        w._predictive_filler_llm_client = Mock()
        w._filler_pool = FillerPool()
        w._filler_pool.add([_clip(f"p{i}", 400.0) for i in range(6)])
        generate = AsyncMock(return_value=0)
        monkeypatch.setattr(w, "_generate_fillers", generate)
        monkeypatch.setattr(worker.settings, "FILLER_REGEN_MIN_FRESH", 5)

        w._filler_regen_signal.set()
        task = asyncio.create_task(w._predictive_filler_loop())
        await asyncio.sleep(0.05)
        task.cancel()

        generate.assert_not_awaited()


class TestStartupFailureShutsDownJob:
    """A startup failure (configure/initialize/start, all pre-connect or
    racing it) must call ctx.shutdown() explicitly.

    livekit-agents' run_job() only resolves its shutdown future when
    ctx.connect(), ctx.shutdown(), or a room-disconnect event fires — an
    unhandled exception in the job task alone does none of those, so the
    job process hangs forever, the agent never joins, and the room is never
    freed. app/worker_v2.py::entrypoint() was fixed for this exact pattern;
    this guards the same fix for v1's entrypoint(), which dispatch_entrypoint
    still routes non-v2 jobs to.
    """

    def _ctx(self):
        return types.SimpleNamespace(
            job=types.SimpleNamespace(id="job-1", metadata="{}"),
            room=types.SimpleNamespace(name="room-1"),
            shutdown=Mock(),
        )

    @pytest.mark.asyncio
    async def test_configure_failure_shuts_down_the_job(self, monkeypatch):
        class ExplodingWorker:
            _timing: dict = {}

            def __init__(self, ctx):
                pass

            async def configure(self):
                raise ValueError("bad metadata")

        monkeypatch.setattr(worker, "AgentWorker", ExplodingWorker)

        ctx = self._ctx()
        with pytest.raises(ValueError, match="bad metadata"):
            await worker.entrypoint(ctx)

        ctx.shutdown.assert_called_once()

    @pytest.mark.asyncio
    async def test_initialize_failure_shuts_down_the_job(self, monkeypatch):
        class ExplodingWorker:
            _timing: dict = {}

            def __init__(self, ctx):
                pass

            async def configure(self):
                pass

            async def initialize(self):
                raise RuntimeError("agent wiring failed")

        monkeypatch.setattr(worker, "AgentWorker", ExplodingWorker)

        ctx = self._ctx()
        with pytest.raises(RuntimeError, match="agent wiring failed"):
            await worker.entrypoint(ctx)

        ctx.shutdown.assert_called_once()


class TestWorkerOptionsShutdownProcessTimeout:
    """shutdown_with_cleanup's own handler chain (app/worker.py:1168) budgets
    well past the SDK's shutdown_process_timeout default of 10s: on_shutdown
    (app/core/events/handlers.py) alone waits up to 3s draining orchestrator
    sends plus up to 16s draining an in-flight finalize task, before
    supervisor-notes/background-audio teardown even runs. Left at the SDK
    default, the ipc supervisor's close_timeout races that budget and kills
    the job process with SIGUSR1 before score/memory persistence finishes —
    seen in production as paired "process did not exit in time, killing
    process" / "exited with non-zero exit code -10" log lines. WorkerOptions
    must therefore set shutdown_process_timeout explicitly, comfortably
    above that ~19s internal budget.
    """

    def _worker_options_call(self):
        source = inspect.getsource(worker)
        tree = ast.parse(source)
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and (
                (
                    isinstance(node.func, ast.Attribute)
                    and node.func.attr == "WorkerOptions"
                )
                or (isinstance(node.func, ast.Name) and node.func.id == "WorkerOptions")
            )
        ]
        assert (
            len(calls) == 1
        ), "expected exactly one WorkerOptions(...) call in app/worker.py"
        return calls[0]

    def test_shutdown_process_timeout_covers_the_finalize_drain_budget(self):
        call = self._worker_options_call()
        kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
        assert "shutdown_process_timeout" in kwargs, (
            "WorkerOptions leaves shutdown_process_timeout unset, so the "
            "SDK default of 10s applies — shorter than the ~19s the "
            "shutdown handler chain (on_shutdown's own drain waits) can "
            "legitimately take, which forces the supervisor to SIGUSR1-kill "
            "the job before it finishes saving score/memory."
        )
        value = ast.literal_eval(kwargs["shutdown_process_timeout"])
        assert value >= 20, (
            f"shutdown_process_timeout={value}s is too tight for the "
            "shutdown handler's own drain budget (3s + 16s = 19s) plus "
            "network time for finalize_session and background-audio/"
            "supervisor-notes teardown"
        )


class TestSessionCostAttribution:
    """AI-cost helpers: the worker hands its room to calls it makes itself."""

    def _worker(self):
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(name="room-w"))
        return worker.AgentWorker(ctx)

    def test_usage_room_id_is_the_livekit_room_name(self):
        assert self._worker()._usage_room_id() == "room-w"

    def test_usage_room_id_tolerates_a_bare_worker(self):
        w = self._worker()
        w.ctx = None
        assert w._usage_room_id() is None

    def test_clip_usage_carries_the_agent_tts_provider_and_model(self):
        w = self._worker()
        w._tts_provider, w._tts_model = "elevenlabs", "eleven_flash_v2_5"
        assert w._clip_usage() == {
            "usage_room_id": "room-w",
            "usage_provider": "elevenlabs",
            "usage_model": "eleven_flash_v2_5",
        }

    @pytest.mark.asyncio
    async def test_pool_embedding_is_recorded_against_the_room(self):
        w = self._worker()
        w.embedding_client = Mock()
        w.embedding_client.get_embeddings_batch = AsyncMock(return_value=[[1.0]])

        await w._working_memory_embed_many()(["a fact"])

        w.embedding_client.get_embeddings_batch.assert_awaited_once_with(
            ["a fact"], task="working_memory_embedding", room_id="room-w"
        )


class TestGapPrior:
    """The first turns are predicted from the voice, not a fixed 900 ms that
    read every session's opening turns as fast and left them unmasked."""

    @pytest.mark.parametrize(
        "model,expected",
        [
            ("eleven_v3", "GAP_PRIOR_GENERATIVE_MS"),
            ("eleven_multilingual_v2", "FILLER_GAP_PRIOR_MS"),
            (None, "FILLER_GAP_PRIOR_MS"),
        ],
    )
    def test_prior_follows_the_voice_model(self, model, expected):
        w = worker.AgentWorker.__new__(worker.AgentWorker)
        w._tts_model = model
        assert w._gap_prior_ms() == float(getattr(worker.settings, expected))
        assert w._gap_prior_ms() >= 2000.0


@pytest.mark.parametrize(
    "model,expected",
    [
        ("eleven_v3", "INTERIM_REPLY_TTS_TIMEOUT_GENERATIVE_MS"),
        ("eleven_multilingual_v2", "INTERIM_REPLY_TTS_TIMEOUT_MS"),
    ],
)
def test_interim_render_timeout_follows_the_voice(model, expected):
    """At 2500 ms every v3 interim timed out in v2v (~3-4 s per sentence)."""
    w = worker.AgentWorker.__new__(worker.AgentWorker)
    w._tts_model = model
    assert w._interim_tts_timeout_ms() == float(getattr(worker.settings, expected))
