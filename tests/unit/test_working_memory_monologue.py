"""The internal monologue: what the preview shows and what survives the session.

This is a diagnostic surface for scenario authors, so the tests pin the two
properties that make it trustworthy — it costs no extra model call, and it
records even when nobody is watching.
"""

import asyncio

from langchain_core.messages import AIMessage, HumanMessage

from app.core.working_memory import monologue
from app.core.working_memory.state import ClientWorkingMemory, Fact
from app.core.working_memory.store import ClientWorkingMemoryStore
from app.core.working_memory.writeout import build_writeout

LADDER = ("Circling", "Getting specific", "Honest sharing")


def _memory(**kw) -> ClientWorkingMemory:
    m = ClientWorkingMemory(stance=kw.pop("stance", "Circling"), ladder=LADDER)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def _turns():
    return [
        HumanMessage(content="How have you been sleeping?"),
        AIMessage(content="Not well, honestly."),
    ]


# ---------------------------------------------------------------------------
# The payload
# ---------------------------------------------------------------------------


def test_the_exchange_is_carried_on_the_card():
    # Without it a stored record is a list of assertions with nothing to
    # explain them: "moved to Getting specific" means nothing if you cannot see
    # what was said.
    p = monologue.build_payload(
        memory=_memory(), update=None, turn_index=2, score=30, messages=_turns()
    )
    assert p["counsellorSaid"] == "How have you been sleeping?"
    assert p["clientSaid"] == "Not well, honestly."


def test_the_agent_is_the_client_not_the_counsellor():
    # The agent plays the CLIENT, so an AI message is the client speaking. Get
    # this backwards and every card in the record attributes both lines wrongly.
    p = monologue.build_payload(
        memory=_memory(), update=None, turn_index=0, score=0, messages=_turns()
    )
    assert p["clientSaid"] == "Not well, honestly."
    assert p["counsellorSaid"] != p["clientSaid"]


def test_the_private_appraisal_is_included():
    # `appraisal` is never sent to the actor — it is scratchpad by design — so
    # this panel is the only place it is ever visible. It is also the field that
    # answers "why did she close up?".
    p = monologue.build_payload(
        memory=_memory(affect="wary", appraisal="he seems to be rushing me"),
        update=None,
        turn_index=1,
        score=10,
    )
    assert p["appraisal"] == "he seems to be rushing me"


def test_the_rendered_sections_are_the_actual_prompt_text():
    # The thing a curator is ultimately editing is the prompt, so the card
    # carries what the actor was handed rather than a description of it.
    p = monologue.build_payload(
        memory=_memory(salient_backstory=[Fact(text="brother stopped calling")]),
        update=None,
        turn_index=1,
        score=0,
    )
    assert "salient" in p["sections"]
    assert "brother stopped calling" in p["sections"]["salient"]


def test_a_missed_update_is_reported_rather_than_skipped():
    # A curator watching odd behaviour needs the cause visible; silence would
    # leave the oddity unexplained.
    p = monologue.build_payload(
        memory=_memory(), update=None, turn_index=4, score=0, missed=True
    )
    assert p["missed"] is True


def test_a_transition_is_distinguishable_from_a_hold():
    held = monologue.build_payload(
        memory=_memory(turns_in_stance=3), update=None, turn_index=3, score=0
    )
    assert held["stanceFrom"] is None
    assert held["turnsInStance"] == 3


# ---------------------------------------------------------------------------
# Recording, which is what makes "revisit it later" possible
# ---------------------------------------------------------------------------


def test_it_records_even_with_no_one_watching():
    # The normal case for a learner session: no preview open, so `publish` has
    # no room and fails. Recording must not be conditional on the live view.
    async def go():
        store = ClientWorkingMemoryStore(initial_stance="Circling", ladder=LADDER)
        published = await monologue.publish_and_record(
            None,
            store,
            monologue.build_payload(
                memory=_memory(), update=None, turn_index=0, score=0
            ),
        )
        return published, store.monologue

    published, recorded = asyncio.run(go())
    assert published is False
    assert len(recorded) == 1


def test_the_record_is_bounded():
    # It rides in a jsonb column at roughly 1.5KB a turn, so it needs a ceiling.
    async def go():
        store = ClientWorkingMemoryStore(initial_stance="Circling", ladder=LADDER)
        for turn in range(monologue.MAX_RECORDED_TURNS + 10):
            await monologue.publish_and_record(
                None,
                store,
                monologue.build_payload(
                    memory=_memory(), update=None, turn_index=turn, score=0
                ),
            )
        return store.monologue

    recorded = asyncio.run(go())
    assert len(recorded) == monologue.MAX_RECORDED_TURNS
    # The recent turns are the ones anyone reads, so the OLD ones are dropped.
    assert recorded[-1]["turn"] == monologue.MAX_RECORDED_TURNS + 9


def test_publishing_never_raises_into_the_turn():
    # Observability must not be able to break a live conversation.
    class Exploding:
        @property
        def local_participant(self):
            raise RuntimeError("boom")

    assert asyncio.run(monologue.publish(Exploding(), {"turn": 1})) is False


# ---------------------------------------------------------------------------
# Survival to the session record
# ---------------------------------------------------------------------------


def test_the_writeout_carries_the_monologue():
    record = build_writeout(
        _memory(disclosed=[Fact(text="she moved out in March")]),
        _turns(),
        monologue=[{"turn": 0}, {"turn": 1}],
    )
    assert record is not None
    assert len(record["monologue"]) == 2


def test_a_monologue_alone_is_enough_to_produce_a_record():
    # A session where the client disclosed nothing is exactly the one someone
    # will want to inspect, so an empty ledger must not discard the monologue.
    record = build_writeout(_memory(), _turns(), monologue=[{"turn": 0}])
    assert record is not None
    assert record["monologue"] == [{"turn": 0}]


def test_an_empty_session_still_leaves_no_trace():
    # The original contract: nothing said, nothing recorded, so the next session
    # opens fresh rather than inheriting a record asserting nothing happened.
    assert build_writeout(_memory(), _turns(), monologue=[]) is None


# ---------------------------------------------------------------------------
# The live broadcast is preview-only; the record is not
# ---------------------------------------------------------------------------


class _Room:
    """Minimal stand-in: only the name and a capturing local participant."""

    def __init__(self, name):
        self.name = name
        self.sent = []
        room = self

        class _Local:
            async def publish_data(self, data, topic=None, reliable=None):
                room.sent.append((topic, data))

        self.local_participant = _Local()


def test_a_learner_session_records_but_never_broadcasts():
    # `publish_data` has no destination filter, so every participant in a room
    # receives it — and in a learner session the learner is one. The payload
    # carries the character's private appraisal OF THE LEARNER plus the literal
    # prompt text. Admin-only in the UI is not admin-only on the network.
    async def go():
        store = ClientWorkingMemoryStore(initial_stance="Circling", ladder=LADDER)
        room = _Room("ss_6d80a48d-26b8-45aa-8b9d-947589fc7329")
        published = await monologue.publish_and_record(
            room,
            store,
            monologue.build_payload(
                memory=_memory(appraisal="he is rushing me"),
                update=None,
                turn_index=0,
                score=0,
            ),
        )
        return published, room.sent, store.monologue

    published, sent, recorded = asyncio.run(go())
    assert published is False
    assert sent == []  # nothing on the wire
    assert len(recorded) == 1  # still reviewable later in the admin dashboard


def test_an_admin_preview_does_broadcast():
    async def go():
        store = ClientWorkingMemoryStore(initial_stance="Circling", ladder=LADDER)
        room = _Room("preview-429-3f2a")
        published = await monologue.publish_and_record(
            room,
            store,
            monologue.build_payload(
                memory=_memory(), update=None, turn_index=0, score=0
            ),
        )
        return published, room.sent

    published, sent = asyncio.run(go())
    assert published is True
    assert len(sent) == 1
    assert sent[0][0] == monologue.MONOLOGUE_TOPIC


def test_sections_carry_trainer_locked_memory_titles():
    """`sections` claims to be the literal text the actor was handed, so the
    titles of trainer-locked memories must be in it — and nothing else of them."""
    p = monologue.build_payload(
        memory=ClientWorkingMemory(),
        update=None,
        turn_index=1,
        score=0,
        locked_topics=["Mother's health"],
    )
    withheld = p["sections"]["withheld"]
    assert "Mother's health — you are not ready to talk about this yet" in withheld


def test_sections_without_locks_drop_the_named_absence():
    p = monologue.build_payload(
        memory=ClientWorkingMemory(), update=None, turn_index=1, score=0
    )
    assert "withheld" not in p["sections"]
