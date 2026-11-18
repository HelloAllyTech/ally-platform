"""The ally-be <-> ally-ai response contract, from one shared fixture.

`docs/debrief-harness/contract-fixture-response.json` is read by this test and by ally-be's
`debrief-graph-contract.spec.ts`. If ally-ai changes what it can send, or ally-be changes what it
can read, one of the two tests fails, so neither side moves alone. The fixture carries fields
nobody declares (`a_*_added_later`) to prove a new optional field passes through both sides.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.debrief_graph.schemas import (
    CONTRACT_VERSION,
    DebriefRunRequest,
    DebriefRunResponse,
)

FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[4]
        / "docs"
        / "debrief-harness"
        / "contract-fixture-response.json"
    ).read_text()
)


def test_the_fixture_is_a_response_ally_ai_can_send_and_it_keeps_what_it_does_not_know():
    res = DebriefRunResponse(**FIXTURE)
    out = res.model_dump()
    assert out["contract_version"] == CONTRACT_VERSION == FIXTURE["contract_version"]
    assert out["status"] == "published"
    assert out["cards"]["lead"].startswith("You stayed")
    assert out["steps"][0]["step"] == "safety_reader"
    assert out["check_failures"][0]["code"] == "QUOTE_NOT_FOUND"
    # Unknown fields are kept, inside the typed shapes too.
    assert out["steps"][0]["a_field_added_later"] is True
    assert out["cards"]["a_card_added_later"] == {
        "note": "an unknown card must pass through untouched"
    }


def test_a_response_without_a_version_reads_as_the_current_one():
    body = {k: v for k, v in FIXTURE.items() if k != "contract_version"}
    assert DebriefRunResponse(**body).contract_version == CONTRACT_VERSION


def test_a_hard_fail_or_check_failure_without_a_code_is_refused():
    with pytest.raises(ValidationError):
        DebriefRunResponse(status="published", evaluator_hard_fails=[{"evidence": "x"}])
    with pytest.raises(ValidationError):
        DebriefRunResponse(status="published", check_failures=[{"section": "x"}])


def test_an_older_ally_be_that_sends_no_version_still_makes_a_valid_request():
    req = DebriefRunRequest(
        run_id="r",
        scenario_session_id="s",
        bundle={},
        ceiling_usd=1.0,
        run_token="t",
        gateway_url="http://x",
    )
    assert req.contract_version == CONTRACT_VERSION


def test_the_typed_shapes_add_no_keys_the_graph_did_not_send():
    """The route sends `exclude_unset`: a card or step ally-be reads has exactly the keys the
    graph built, never null or empty ones added by the typed models."""
    res = DebriefRunResponse(
        status="published",
        cards={"lead": "x"},
        steps=[{"step": "writer"}],
        evaluator_hard_fails=[{"code": "c"}],
    )
    out = res.model_dump(exclude_unset=True)
    assert out["cards"] == {"lead": "x"}
    assert out["steps"] == [{"step": "writer"}]
    assert out["evaluator_hard_fails"] == [{"code": "c"}]
