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
