"""Turn-loop tests: scripted LLMs drive a full transition + unlock."""

from langchain_core.messages import AIMessage

from app.roleplay_v2.session.turn_loop import RoleplayTurnEngine
from tests.roleplay_v2.test_director import FakeDirectorLLM, make_verdict


class FakeActorLLM:
    """Scripted actor chat model."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(list(messages))
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return AIMessage(content=reply)


class TestTurnLoop:
    async def test_opening_uses_scripted_statement(self, sample_spec):
        engine = RoleplayTurnEngine(sample_spec, FakeActorLLM(["never used"]))
        result = await engine.opening()
        assert result.actor_text == sample_spec.opening_statement
        assert result.verdict is None
        assert engine.history[0].content == sample_spec.opening_statement

    async def test_opening_generates_when_no_statement(self, sample_spec):
        spec = sample_spec.model_copy(deep=True)
        spec.opening_statement = None
        actor = FakeActorLLM(["Um, hi. I guess I'm here now."])
        engine = RoleplayTurnEngine(spec, actor)
        result = await engine.opening()
        assert result.actor_text == "Um, hi. I guess I'm here now."
        assert len(actor.calls) == 1

    async def test_full_transition_and_unlock_flow(self, sample_spec):
        """Four scripted turns: Guarded → Testing → (build) → Opening + unlock."""
        actor = FakeActorLLM(
            [
                "It's fine. Everyone's tired, right?",
                "...I don't sleep much. It's not a big deal.",
                "Four months without a real weekend. Saying it out loud is weird.",
                "There's something I haven't told anyone. Six weeks ago...",
            ]
        )
        verdicts = [
            make_verdict(turn_index=1, observed=["beh-validation"]),
            make_verdict(
                turn_index=2,
                observed=["beh-reflective-listening"],
                satisfied_guards=["t-guarded-testing"],
                next_state_id="state-testing",
                stage_direction="Risk one true detail.",
                retrieve_topics=["sleep"],
            ),
            make_verdict(
                turn_index=3,
                observed=["beh-open-questions", "beh-validation"],
                satisfied_guards=[],
            ),
            make_verdict(
                turn_index=4,
                observed=["beh-open-questions", "beh-validation"],
                satisfied_guards=["t-testing-opening"],
                next_state_id="state-opening",
                unlock_ids=["secret-parking"],
            ),
        ]
        engine = RoleplayTurnEngine(
            sample_spec, actor, FakeDirectorLLM(verdicts), room_id="loop-test"
        )
        await engine.opening()

        r1 = await engine.trainee_turn("That sounds genuinely exhausting.")
        assert r1.state_snapshot.current_state_id == "state-guarded"
        assert r1.state_snapshot.cumulative_score == 2.0

        r2 = await engine.trainee_turn("You've been holding a lot together.")
        assert r2.state_snapshot.current_state_id == "state-testing"
        assert r2.state_snapshot.retrieve_topics == ["sleep"]

        r3 = await engine.trainee_turn("What do those nights look like?")
        assert r3.state_snapshot.current_state_id == "state-testing"

        r4 = await engine.trainee_turn("What's the heaviest part of all this?")
        snap = r4.state_snapshot
        assert snap.current_state_id == "state-opening"
        assert snap.ledger["secret-parking"] == "unlocked"
        assert snap.state_path == [
            "state-guarded",
            "state-testing",
            "state-opening",
        ]
        assert snap.director_commits == 4
        assert snap.director_misses == 0
        # The verdict is returned inline in awaited mode.
        assert r4.verdict is not None
        assert r4.verdict.unlock_ids == ["secret-parking"]

        # Emitter trace captured the full journey.
        types = [t["type"] for t in engine.emitter.trace]
        assert types.count("director_state_transition") == 2
        assert "director_disclosure_unlock" in types

    async def test_fire_and_forget_mode_returns_no_verdict(self, sample_spec):
        actor = FakeActorLLM(["Hmm."])
        verdicts = [make_verdict(turn_index=1, observed=["beh-validation"])]
        engine = RoleplayTurnEngine(sample_spec, actor, FakeDirectorLLM(verdicts))
        await engine.opening()
        result = await engine.trainee_turn("Hello there.", await_director=False)
        assert result.verdict is None
        await engine.close()  # flush the background director task
        snap = await engine.state_store.snapshot()
        assert snap.cumulative_score == 2.0

    async def test_actor_sees_unlocked_content_only_after_unlock(self, sample_spec):
        """The ledger gate is visible in the prompts the actor LLM receives."""
        actor = FakeActorLLM(["reply one", "reply two"])
        verdicts = [
            make_verdict(
                turn_index=1,
                observed=["beh-open-questions", "beh-validation"],
                satisfied_guards=[],
            ),
        ]
        engine = RoleplayTurnEngine(sample_spec, actor, FakeDirectorLLM(verdicts))
        await engine.opening()
        await engine.trainee_turn("hi")
        parking = sample_spec.get_secret("secret-parking")
        first_turn_card = actor.calls[0][-1].content
        assert parking.content not in first_turn_card
        # Force-unlock via the store, then verify the next prompt includes it.
        await engine.state_store.begin_turn()
        await engine.state_store.commit(2, unlock_ids=["secret-parking"])
        # Bypass turn counting: generate directly against fresh snapshot.
        await engine.actor.generate(engine.history)
        second_turn_card = actor.calls[-1][-1].content
        assert parking.content in second_turn_card
