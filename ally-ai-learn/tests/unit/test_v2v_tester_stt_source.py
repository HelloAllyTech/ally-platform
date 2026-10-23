"""Which track the V2V tester transcribes.

One STT pipeline per run, with exactly one exception: a video actor attaching
mid-session takes the character's speech onto its own track and leaves the
agent's original track published and silent. A tester that does not follow it
goes deaf from the attach onward and reports an idle timeout — a failure
indistinguishable from a broken agent, which is why this rule has a test of its
own rather than living only inside an event handler.
"""

import pytest

from app.v2v_tester.tester_bot import should_take_over_stt


class TestSttSourceSelection:
    @pytest.mark.unit
    def test_the_first_audio_track_wins(self):
        assert (
            should_take_over_stt(
                current_sid=None, current_is_avatar=False, new_identity="agent-AJ_x"
            )
            is True
        )

    @pytest.mark.unit
    def test_a_second_agent_track_does_not_take_over(self):
        """The agent publishes its voice AND a background-audio track."""
        assert (
            should_take_over_stt(
                current_sid="TR_1", current_is_avatar=False, new_identity="agent-AJ_x"
            )
            is False
        )

    @pytest.mark.unit
    def test_an_avatar_takes_over_from_the_agents_own_track(self):
        assert (
            should_take_over_stt(
                current_sid="TR_1",
                current_is_avatar=False,
                new_identity="bey-avatar-agent",
            )
            is True
        )

    @pytest.mark.unit
    def test_every_vendors_avatar_is_recognised(self):
        for identity in (
            "bey-avatar-agent",
            "tavus-avatar-agent",
            "anam-avatar-agent",
            "simli-avatar-agent",
        ):
            assert (
                should_take_over_stt(
                    current_sid="TR_1",
                    current_is_avatar=False,
                    new_identity=identity,
                )
                is True
            ), identity

    @pytest.mark.unit
    def test_nothing_takes_over_from_the_avatar(self):
        """Once the speech is on the avatar it stays there, so a late track —
        the agent's own, or a second avatar publication — must not steal it
        back onto a channel that is now silent."""
        for identity in ("agent-AJ_x", "bey-avatar-agent"):
            assert (
                should_take_over_stt(
                    current_sid="TR_1",
                    current_is_avatar=True,
                    new_identity=identity,
                )
                is False
            ), identity

    @pytest.mark.unit
    def test_a_learner_never_takes_over(self):
        assert (
            should_take_over_stt(
                current_sid="TR_1", current_is_avatar=False, new_identity="user-42"
            )
            is False
        )
