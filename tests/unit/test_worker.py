import asyncio
import types
import pytest

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

        class DummySTT:
            def __init__(self, model, language, api_key):
                created["stt"] = {"model": model, "language": language, "api_key": bool(api_key)}

        monkeypatch.setattr(worker.deepgram, "STT", DummySTT)

        class DummyTD:
            pass

        monkeypatch.setattr(worker, "MultilingualModel", DummyTD)

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
        session = worker.create_agent_session(tts_config, vad)

        assert isinstance(session, DummyAgentSession)
        assert created["stt"]["model"] == "nova-3"
        assert created["stt"]["language"] == "en-IN"
        assert created["stt"]["api_key"] is True
        assert session.tts == "TTS"
        assert session.vad == "VAD"
        assert isinstance(session.turn_detection, DummyTD)

    # -------------------- entrypoint --------------------
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
        # Parse metadata -> scenario
        scenario = types.SimpleNamespace(
            voice="en",
            prompt_data=types.SimpleNamespace(gender="male", opening_statements=["hello", "hi"]),
            events=["E1"],
        )

        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md: rm_md_envelope)

        # TTS config
        tts_called = {}
        monkeypatch.setattr(worker, "get_tts_for_scenario", lambda voice, gender: tts_called.setdefault("ok", True) or "TTS")

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
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad: dummy_session)

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
                self.room = types.SimpleNamespace(name="room-xyz")
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
            async def connect(self):
                return None

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
            voice="en",
            prompt_data=types.SimpleNamespace(gender="female", opening_statements=["hello"]),
            events=[],
        )
        rm_md_envelope = types.SimpleNamespace(scenario=scenario)
        monkeypatch.setattr(worker, "parse_room_metadata", lambda md: rm_md_envelope)

        def boom(*a, **k):
            raise RuntimeError("tts fail")

        monkeypatch.setattr(worker, "get_tts_for_scenario", boom)

        fallback_used = {}
        def fake_default_tts(gender):
            fallback_used["used"] = gender
            return "DEFAULT_TTS"

        monkeypatch.setattr(worker, "get_default_tts_config", fake_default_tts)

        dummy_session = self.DummySession()
        monkeypatch.setattr(worker, "create_agent_session", lambda tts, vad: dummy_session)
        monkeypatch.setattr(worker, "Assistant", self.DummyAgent)
        monkeypatch.setattr(worker, "LLMAdapter", lambda *a, **k: object())
        monkeypatch.setattr(worker.agent_graph, "update_state", lambda *a, **k: None)
        monkeypatch.setattr(worker, "create_conversation_handler", lambda *a, **k: (lambda e: None))
        monkeypatch.setattr(worker.noise_cancellation, "BVC", lambda: object())
        monkeypatch.setattr(worker, "RoomInputOptions", lambda **k: object())

        class Ctx:
            def __init__(self):
                self.job = types.SimpleNamespace(metadata="{}")
                self.room = types.SimpleNamespace(name="room-xyz")
                self.proc = types.SimpleNamespace(userid="u", userdata={"vad": "VAD"})
            async def connect(self):
                return None

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
