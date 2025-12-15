import asyncio
import types
import pytest
from unittest.mock import Mock

import app.worker as worker


class TestWorker:
    # -------------------- initialize_agent_state --------------------
    def test_initialize_agent_state_updates_graph(self, monkeypatch):
        captured = {}

        def fake_update_state(config, values):
            captured["config"] = config
            captured["values"] = values

        monkeypatch.setattr(worker.agent_graph, "update_state", fake_update_state)

        scenario = types.SimpleNamespace(events=["A", "B"])
        worker.initialize_agent_state("room-1", scenario)

        assert captured["config"] == {"configurable": {"thread_id": "room-1"}}
        assert captured["values"]["permitted_events"] == ["A", "B"]
        assert captured["values"]["messages"] == []
        assert captured["values"]["events_accumulator"] == []
        assert captured["values"]["new_events"] == []
        assert captured["values"]["current_score"] == 0

    # -------------------- create_agent_session --------------------
    def test_create_agent_session_uses_expected_components(self, monkeypatch):
        # Dummy components to capture inputs
        created = {}

        class DummyAgentSession:
            def __init__(self, stt, tts, vad, turn_detection):
                self.stt = stt
                self.tts = tts
                self.vad = vad
                self.turn_detection = turn_detection
                created["session"] = True

        monkeypatch.setattr(worker, "AgentSession", DummyAgentSession)

        tts_config = "TTS"
        vad = "VAD"
        stt_config = "STT"
        session = worker.create_agent_session(tts_config, vad, stt_config)

        assert isinstance(session, DummyAgentSession)
        assert session.stt == "STT"
        assert session.tts == "TTS"
        assert session.vad == "VAD"
        assert session.turn_detection == "vad"  # Worker now uses "vad" string

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

        async def say(self, text):
            self.said.append(text)

    class DummyAgent:
        def __init__(self, llm):
            self.llm = llm

    @pytest.mark.asyncio
    async def test_entrypoint_happy_path(self, monkeypatch):
        # Create a mock event object
        from app.core.constants import DetectionType
        mock_event = types.SimpleNamespace(
            event_id="E1",
            detection_type=DetectionType.SENTENCE_SIMILARITY,
            sentences=["hello"]
        )

        # Parse metadata -> scenario
        scenario = types.SimpleNamespace(
            voice=None,  # No voice config, will use defaults
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello", "hi"]),
            language_config=None,  # Can be None, will default to DEFAULT_LANGUAGE_CODE
            events=[mock_event],
            trigger_events=None,
            termination_event=None
        )

        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        # STT config
        stt_called = {}
        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        def mock_create_stt_client(stt_config=None, language_code=None):
            stt_called["ok"] = True
            return MockSTTClient()
        monkeypatch.setattr(worker, "create_stt_client", mock_create_stt_client)

        # TTS config
        tts_called = {}
        def mock_create_tts(*a, **k):
            tts_called.setdefault("ok", True)
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        # Graph update already tested; still keep it deterministic
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)

        # LLMAdapter -> return simple object with captured cfg
        class DummyAdapter:
            def __init__(self, graph, config):
                self.graph = graph
                self.config = config

        monkeypatch.setattr(worker, "LLMAdapter", DummyAdapter)

        # Assistant -> DummyAgent
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)

        # Session factory
        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)

        # Conversation handler factory (just return passthrough fn)
        called_handler = {}
        def fake_handler_factory(room_id, joined_iso):
            def _h(evt):
                called_handler["called"] = True
            return _h

        monkeypatch.setattr(worker, "create_conversation_handler", fake_handler_factory)

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
                self.job = types.SimpleNamespace(metadata="{}")
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
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="female", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        # STT should work fine
        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        monkeypatch.setattr(worker, "create_stt_client", lambda stt_config=None, language_code=None: MockSTTClient())

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
                return mock_client
        
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
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
    @pytest.mark.asyncio
    async def test_publish_termination_audio_success(self, monkeypatch):
        say_called = {}
        wait_called = {}

        class MockHandler:
            async def wait_for_playout(self):
                wait_called["called"] = True

        class MockSession:
            async def interrupt(self):
                pass
            
            def say(self, message, allow_interruptions=True):
                say_called["message"] = message
                return MockHandler()

        message = "Session ended"
        session = MockSession()

        await worker.publish_termination_audio(message, session)

        assert "message" in say_called
        assert say_called["message"] == "Session ended"
        assert "called" in wait_called

    @pytest.mark.asyncio
    async def test_publish_termination_audio_handles_exception(self, monkeypatch):
        class MockSession:
            async def interrupt(self):
                pass
            
            def say(self, message, allow_interruptions=True):
                raise RuntimeError("TTS synthesis failed")

        message = "Session ended"
        session = MockSession()

        with pytest.raises(RuntimeError, match="TTS synthesis failed"):
            await worker.publish_termination_audio(message, session)

    # -------------------- entrypoint additional tests --------------------
    @pytest.mark.asyncio
    async def test_entrypoint_stt_fallback(self, monkeypatch):
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

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

        monkeypatch.setattr(worker, "create_stt_client", fake_stt_with_fallback)

        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
                self.room = TestWorker.DummyRoom()
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
                self._shutdown_callbacks = []

            async def connect(self):
                return None

            def add_shutdown_callback(self, callback):
                self._shutdown_callbacks.append(callback)

        await worker.entrypoint(Ctx())

        assert fallback_used["used"] is not None

    @pytest.mark.asyncio
    async def test_entrypoint_initializes_event_orchestrator(self, monkeypatch):
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        monkeypatch.setattr(worker, "create_stt_client", lambda stt_config=None, language_code=None: MockSTTClient())
        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        registry_init_called = {}

        class MockEventOrchestrator:
            def __init__(self, scenario, termination_callback, room, thread_id):
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
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
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
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        monkeypatch.setattr(worker, "create_stt_client", lambda stt_config=None, language_code=None: MockSTTClient())
        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
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
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        monkeypatch.setattr(worker, "create_stt_client", lambda stt_config=None, language_code=None: MockSTTClient())
        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        registry_instance = {}

        class MockEventOrchestrator:
            def __init__(self, scenario, termination_callback, room, thread_id):
                self.termination_callback = termination_callback
                self.termination_message = "Goodbye"
                registry_instance["instance"] = self

            async def initialize(self):
                pass

            def is_termination_initiated(self):
                return False

        monkeypatch.setattr(worker, "EventOrchestrator", MockEventOrchestrator)

        publish_called = {}
        async def mock_publish(message, session):
            publish_called["message"] = message

        monkeypatch.setattr(worker, "publish_termination_audio", mock_publish)

        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
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
        await worker.entrypoint(ctx)

        # Test termination callback - get it from the registry instance after it's been set
        mock_event = types.SimpleNamespace(event_id="term-event")
        task = await registry_instance["instance"].termination_callback(mock_event)
        await task

        assert publish_called["message"] == "Goodbye"
        assert ctx.shutdown_called is True

    @pytest.mark.asyncio
    async def test_entrypoint_skips_opening_statement_when_termination_initiated(self, monkeypatch):
        """Test that opening statement is skipped when termination is initiated during initialization."""
        scenario = types.SimpleNamespace(
            voice=None,
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello"]),
            events=[],
            language_config=None,
            trigger_events=None,
            termination_event=None
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md, embedding_client=None: rm_md_envelope)

        class MockSTTClient:
            def __init__(self):
                self.stt_instance = "STT"
        monkeypatch.setattr(worker, "create_stt_client", lambda stt_config=None, language_code=None: MockSTTClient())
        def mock_create_tts(*a, **k):
            mock_client = Mock()
            mock_client.tts_instance = "TTS"
            return mock_client
        monkeypatch.setattr(worker, "create_tts_client", mock_create_tts)

        class MockEventOrchestrator:
            def __init__(self, scenario, termination_callback, room, thread_id):
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
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad, stt: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
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
