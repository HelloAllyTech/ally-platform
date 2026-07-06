"""Actor tests: prompt layering, ledger safety, retrieval, and the engine."""

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.roleplay_v2.actor.engine import ActorEngine
from app.roleplay_v2.actor.prompt_compiler import (
    compile_static_prefix,
    compile_turn_card,
)
from app.roleplay_v2.actor.retrieval.persona_bible import select_chunks


class FakeChatModel:
    """Scripted LangChain-shaped chat model (no network)."""

    def __init__(self, replies=None):
        self.replies = list(replies or ["Scripted reply."])
        self.calls = []

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(list(messages))
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return AIMessage(content=reply)


class TestStaticPrefix:
    def test_byte_stable_across_compilations(self, sample_spec):
        one = compile_static_prefix(sample_spec)
        two = compile_static_prefix(sample_spec)
        assert one == two
        assert one.encode("utf-8") == two.encode("utf-8")

    def test_contains_identity_and_context_in_order(self, sample_spec):
        prefix = compile_static_prefix(sample_spec)
        identity_pos = prefix.find("Maya Krishnan")
        context_pos = prefix.find("the parking incident")
        assert identity_pos != -1
        assert context_pos != -1
        assert identity_pos < context_pos  # L1 before L2
        assert sample_spec.language_code in prefix

    def test_audio_tag_guidance_appended_statically(self, sample_spec):
        plain = compile_static_prefix(sample_spec)
        tagged = compile_static_prefix(
            sample_spec, audio_tag_instructions="[sighs] [pause]"
        )
        assert "[sighs] [pause]" not in plain
        assert tagged.startswith(plain)
        assert "[sighs] [pause]" in tagged
        # Still byte-stable with the same arguments.
        assert tagged == compile_static_prefix(
            sample_spec, audio_tag_instructions="[sighs] [pause]"
        )


class TestTurnCard:
    async def test_locked_secret_content_never_rendered(self, sample_spec, state_store):
        snapshot = await state_store.snapshot()
        card = compile_turn_card(sample_spec, snapshot, chunks=[])
        for secret in sample_spec.disclosure_ledger.secrets:
            assert secret.content not in card
            assert secret.topic in card
            assert secret.locked_deflection in card

    async def test_unlocked_secret_content_rendered(self, sample_spec, state_store):
        await state_store.begin_turn()
        await state_store.commit(1, unlock_ids=["secret-parking"])
        snapshot = await state_store.snapshot()
        card = compile_turn_card(sample_spec, snapshot, chunks=[])
        parking = sample_spec.get_secret("secret-parking")
        resign = sample_spec.get_secret("secret-resign-draft")
        assert parking.content in card
        assert resign.content not in card  # still locked

    async def test_layer_ordering_l3_l4_l5_l6(self, sample_spec, state_store):
        snapshot = await state_store.snapshot()
        chunks = sample_spec.persona.chunks[:1]
        card = compile_turn_card(sample_spec, snapshot, chunks=chunks)
        l3 = card.find("Your current state")
        l4 = card.find("Disclosure ledger")
        l5 = card.find("Background memories")
        l6 = card.find("Stage direction")
        assert -1 not in (l3, l4, l5, l6)
        assert l3 < l4 < l5 < l6
        # L3 renders ONLY the current state's card, not other states'.
        assert "Guarded" in card
        assert sample_spec.get_state("state-disclosing").state_card not in card

    async def test_stage_direction_falls_back_to_state_default(
        self, sample_spec, state_store
    ):
        snapshot = await state_store.snapshot()
        card = compile_turn_card(sample_spec, snapshot, chunks=[])
        default = sample_spec.state_machine.initial_state.default_stage_direction
        assert default in card

    async def test_director_stage_direction_wins(self, sample_spec, state_store):
        await state_store.begin_turn()
        await state_store.commit(1, stage_direction="Let one crack of feeling show.")
        snapshot = await state_store.snapshot()
        card = compile_turn_card(sample_spec, snapshot, chunks=[])
        assert "Let one crack of feeling show." in card


class TestRetrieval:
    def test_director_topics_ranked_first(self, sample_spec):
        chunks = select_chunks(
            sample_spec,
            retrieve_topics=["family"],
            last_user_text="tell me about your job and your team",
        )
        assert chunks[0].id == "chunk-family"

    def test_keyword_fallback_without_director_topics(self, sample_spec):
        chunks = select_chunks(
            sample_spec,
            retrieve_topics=[],
            last_user_text="How have you been sleeping lately?",
        )
        assert chunks[0].id == "chunk-health"

    def test_no_signal_falls_back_to_spec_order(self, sample_spec):
        chunks = select_chunks(sample_spec, retrieve_topics=None, last_user_text="")
        assert chunks
        assert chunks[0].id == sample_spec.persona.chunks[0].id

    def test_char_cap_bounds_selection(self, sample_spec):
        capped = select_chunks(
            sample_spec,
            retrieve_topics=[],
            last_user_text="",
            max_chars=len(sample_spec.persona.chunks[0].content) + 10,
        )
        assert len(capped) == 1


class TestActorEngine:
    async def test_build_messages_layout(self, sample_spec, state_store):
        engine = ActorEngine(sample_spec, state_store, FakeChatModel())
        history = [
            AIMessage(content="Hi... thanks for seeing me."),
            HumanMessage(content="What brings you in today?"),
        ]
        messages = await engine.build_messages(history)
        assert isinstance(messages[0], SystemMessage)
        assert messages[0].content == engine.static_prefix
        assert messages[1:-1] == history
        assert isinstance(messages[-1], SystemMessage)
        assert "TURN CARD" in messages[-1].content

    async def test_generate_returns_text_and_llm_sees_layers(
        self, sample_spec, state_store
    ):
        llm = FakeChatModel(replies=["It's fine. Work is just busy."])
        engine = ActorEngine(sample_spec, state_store, llm)
        text = await engine.generate([HumanMessage(content="How are you, really?")])
        assert text == "It's fine. Work is just busy."
        sent = llm.calls[0]
        assert sent[0].content == engine.static_prefix
        assert "Disclosure ledger" in sent[-1].content

    async def test_static_prefix_identical_across_turns(self, sample_spec, state_store):
        engine = ActorEngine(sample_spec, state_store, FakeChatModel())
        first = (await engine.prepare([HumanMessage(content="a")])).messages[0].content
        await state_store.begin_turn()
        await state_store.commit(
            1, next_state_id="state-testing", stage_direction="Shift."
        )
        second = (await engine.prepare([HumanMessage(content="b")])).messages[0].content
        assert first == second


class TestActorGraph:
    async def test_graph_advances_turn_and_calls_hook(self, sample_spec, state_store):
        from app.roleplay_v2.actor.graph import build_actor_graph

        llm = FakeChatModel(replies=["I'm managing."])
        engine = ActorEngine(sample_spec, state_store, llm)
        graph = build_actor_graph(engine)
        hook_calls = []

        def on_turn(turn_index, trainee_text, actor_text):
            hook_calls.append((turn_index, trainee_text, actor_text))

        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="How are you doing?")]},
            {"configurable": {"thread_id": "room-1", "on_turn": on_turn}},
        )
        assert result["messages"][-1].content == "I'm managing."
        assert hook_calls == [(1, "How are you doing?", "I'm managing.")]
        snap = await state_store.snapshot()
        assert snap.turn_index == 1

    async def test_graph_opening_turn_does_not_advance(self, sample_spec, state_store):
        from app.roleplay_v2.actor.graph import build_actor_graph

        engine = ActorEngine(sample_spec, state_store, FakeChatModel())
        graph = build_actor_graph(engine)
        hook_calls = []
        await graph.ainvoke(
            {"messages": []},
            {"configurable": {"thread_id": "room-1", "on_turn": hook_calls.append}},
        )
        snap = await state_store.snapshot()
        assert snap.turn_index == 0
        assert hook_calls == []
