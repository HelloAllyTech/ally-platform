"""The planted-idea fixtures for the PM agent's offline 'right final state' eval
are well formed and render as a run's first message. (No eval runner yet.)"""

import json
from pathlib import Path

from app.core.pm_agent.prompt import render_inputs
from app.core.pm_agent.quotes import strip_quotes

FIXTURE = Path(__file__).parents[2] / "fixtures" / "pm_agent_planted_ideas.json"


def test_one_good_one_bad_one_neutral_with_a_known_right_answer():
    cases = json.loads(FIXTURE.read_text())["cases"]
    assert sorted(c["kind"] for c in cases) == ["bad", "good", "neutral"]
    for c in cases:
        right = c["right_final_state"]
        assert right["expected"] in ("promote", "reject")
        assert right["max_cost_usd"] > 0
        assert c["planted_change"]["route"] in "ABCD"
        assert c["planted_change"]["expected_effect"]["direction"] in ("up", "down")
        change = c["planted_change"]
        if change["kind"] == "prompt_edit":
            live = c["inputs"]["editable_prompts"][change["prompt_code"]]
            assert live.count(change["find"]) == 1  # the planted edit applies
        msg = render_inputs("weekly", c["inputs"])
        assert msg.startswith("REVIEW: weekly.") and "<metric_failure_points>" in msg
        # Synthetic, quote-free comment text: nothing for Builder to leak.
        for comment in c["inputs"]["comments_since_last_run"]:
            assert strip_quotes(comment["body"])[1] == 0
    by_kind = {c["kind"]: c for c in cases}
    assert by_kind["good"]["right_final_state"]["expected"] == "promote"
    assert by_kind["bad"]["right_final_state"]["forbidden_actions"]
