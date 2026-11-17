"""The PM agent can read a Debrief prompt's live text (review 2026-11-16: it
could not quote the risk cue definition)."""

import pytest

from app.core.pm_agent.tools import (
    CONVERSATION_TOOLS,
    READ_TOOLS,
    SUBAGENT_READ_TOOLS,
    make_tools,
)


class _Gateway:
    def __init__(self):
        self.calls = []

    async def call(self, name, body):
        self.calls.append((name, body))
        return {
            "code": body["code"],
            "version": "current",
            "text": "A clear risk cue...",
        }


class _Ledger:
    def __init__(self):
        self.refusals, self.idea_ids, self.tool_texts = [], [], []


def test_prompt_read_is_a_read_tool_everywhere():
    assert "prompt_read" in READ_TOOLS
    assert "prompt_read" in SUBAGENT_READ_TOOLS
    assert "prompt_read" in CONVERSATION_TOOLS


@pytest.mark.asyncio
async def test_prompt_read_calls_ally_be_with_the_code():
    gw = _Gateway()
    tools = {t.name: t for t in make_tools(gw, _Ledger(), allowed=["prompt_read"])}
    out = await tools["prompt_read"].ainvoke({"code": "debrief_risk_cue_definition"})
    assert gw.calls == [("prompt_read", {"code": "debrief_risk_cue_definition"})]
    assert "A clear risk cue" in out


def test_guidance_report_is_a_read_tool_everywhere():
    assert "guidance_report" in READ_TOOLS
    assert "guidance_report" in SUBAGENT_READ_TOOLS


@pytest.mark.asyncio
async def test_guidance_report_calls_ally_be_and_drops_unset_args():
    class Gw(_Gateway):
        async def call(self, name, body):
            self.calls.append((name, body))
            return {"runs": 3}

    gw = Gw()
    tools = {t.name: t for t in make_tools(gw, _Ledger(), allowed=["guidance_report"])}
    assert "guidance lookup and the guidance agent" in tools[
        "guidance_report"
    ].description
    await tools["guidance_report"].ainvoke({})
    await tools["guidance_report"].ainvoke({"days": 7, "mode": "live"})
    assert gw.calls == [
        ("guidance_report", {"days": 30}),
        ("guidance_report", {"days": 7, "mode": "live"}),
    ]
    with pytest.raises(Exception):
        await tools["guidance_report"].ainvoke({"days": 120})


@pytest.mark.asyncio
async def test_guidance_report_refusal_is_a_tool_error_and_recorded():
    class Gw:
        async def call(self, name, body):
            return {"refused": "no permission"}

    ledger = _Ledger()
    tools = {t.name: t for t in make_tools(Gw(), ledger, allowed=["guidance_report"])}
    out = await tools["guidance_report"].ainvoke({})
    assert "Refused by ally-be: no permission" in out
    assert ledger.refusals == [{"tool": "guidance_report", "reason": "no permission"}]
