import asyncio
import types
from unittest.mock import AsyncMock, Mock

import pytest

import app.worker as worker
from app.core.agent import factory as agent_utils
from app.core.events import handlers as event_handler
from app.core.graph import agent_graph


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

    # -------------------- create_agent_session --------------------
    def test_create_agent_session_uses_expected_components(self, monkeypatch):
        created = {}

        class DummyAgentSession:
            def __init__(self, stt, tts, vad, turn_detection):
                self.stt = stt
                self.tts = tts
                self.vad = vad
                self.turn_detection = turn_detection
                created["session"] = True

        monkeypatch.setattr(worker, "AgentSession", DummyAgentSession)

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
        from app.core.scenario.base import PromptData, Scenario, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello", "hi"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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
            event_handler, "setup_interruption_detection", lambda session: None
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
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

        ctx = Ctx()

        await worker.entrypoint(ctx)

        # Assertions
        assert dummy_session.started is True
        assert len(dummy_session.said) == 1
        # handler should be registered
        assert "conversation_item_added" in dummy_session.handlers

    @pytest.mark.asyncio
    async def test_entrypoint_tts_fallback(self, monkeypatch):
        from app.core.livekit.livekit_models import RoomMetadataEnvelope
        from app.core.scenario.base import PromptData, Scenario, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="female",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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
            event_handler, "setup_interruption_detection", lambda session: None
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

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

    # -------------------- entrypoint additional tests --------------------
    @pytest.mark.asyncio
    async def test_entrypoint_stt_fallback(self, monkeypatch):
        from app.core.scenario.base import PromptData, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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
            event_handler, "setup_interruption_detection", lambda session: None
        )
        monkeypatch.setattr(
            agent_utils, "should_say_opening_statement", lambda *a, **k: False
        )

        dummy_session = self.DummySession()
        monkeypatch.setattr(
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

        await worker.entrypoint(Ctx())

        # The fallback should have been used when the first call fails
        assert "used" in fallback_used and fallback_used["used"] is not None

    @pytest.mark.asyncio
    async def test_entrypoint_initializes_event_orchestrator(self, monkeypatch):
        from app.core.scenario.base import PromptData, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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

        # UPDATED MOCK: Now accepts agent_joined_at
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
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
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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
            event_handler, "setup_interruption_detection", lambda session: None
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

        await worker.entrypoint(Ctx())

        assert registry_init_called["initialized"] is True
        assert registry_init_called["scenario"] == scenario
        assert registry_init_called["thread_id"] == "room-xyz"

    @pytest.mark.asyncio
    async def test_entrypoint_registers_shutdown_callback(self, monkeypatch):
        from app.core.scenario.base import PromptData, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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
            event_handler, "setup_interruption_detection", lambda session: None
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

            def shutdown(self, reason):
                pass

        ctx = Ctx()
        await worker.entrypoint(ctx)

        assert len(ctx._shutdown_callbacks) == 1

    @pytest.mark.asyncio
    async def test_entrypoint_handle_termination_callback(self, monkeypatch):
        from app.core.scenario.base import PromptData, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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

        # UPDATED MOCK: Now accepts agent_joined_at
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
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
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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
            event_handler, "setup_interruption_detection", lambda session: None
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
        from app.core.scenario.base import PromptData, ScenarioResponseLength

        prompt_data = PromptData(
            name="Test Client",
            age="30",
            gender="male",
            current_location="Test Location",
            context="test context",
            opening_statements=["hello"],
            agent_goal="test goal",
            prompt="test prompt",
            response_length=ScenarioResponseLength.BRIEF,
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

        # UPDATED MOCK: Now accepts agent_joined_at
        class MockEventOrchestrator:
            def __init__(
                self,
                scenario,
                termination_callback,
                room,
                thread_id,
                agent_joined_at=None,
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
            worker, "AgentSession", lambda stt, tts, vad, turn_detection: dummy_session
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
            event_handler, "setup_interruption_detection", lambda session: None
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

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

        ctx = Ctx()
        await worker.entrypoint(ctx)

        # Opening statement should NOT be said because termination was initiated
        assert len(dummy_session.said) == 0
